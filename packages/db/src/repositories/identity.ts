// Drizzle repositories for the identity module (ticket #3). Implements the
// port contracts exported by `@formforge/core/identity`; the web composition
// root enforces the structural match at typecheck time.
//
// INTEGRATION-DEBT: awaiting T02 — tables and Db come from ../bridge.ts until
// T02's src/schema/** and client land; input/output DTOs mirror the identity
// ports. After T02: swap the import to "../schema" + T02's client and re-derive
// the DTOs from the ports if desired.
import { eq } from "drizzle-orm";
import type { Db } from "../bridge";
import { memberships, users, workspaces } from "../bridge";

export type WorkspacePlan = "free" | "pro" | "business";
export type MembershipRole = "owner" | "admin" | "editor" | "viewer";

export type UserRecord = {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  plan: WorkspacePlan;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
};

export type MembershipRecord = {
  workspaceId: string;
  userId: string;
  role: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

// --- mappers (snake_case columns ↔ camelCase records) ----------------------

function toUser(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    emailVerifiedAt: row.emailVerifiedAt,
    createdAt: row.createdAt,
  };
}

function toWorkspace(row: typeof workspaces.$inferSelect): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    // text column constrained by CHECK in migration + input validation; cast mirrors drizzle schema typing.
    plan: row.plan as WorkspacePlan,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    createdAt: row.createdAt,
  };
}

// --- repositories -----------------------------------------------------------

export class DrizzleUserRepository {
  constructor(private readonly db: Db) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  // Ticket #5: password reset — replace the stored hash.
  async setPasswordHash(id: string, passwordHash: string | null): Promise<void> {
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }

  // Ticket #5: email verification — update the verified-at column.
  async markEmailVerified(id: string, verifiedAt: Date): Promise<void> {
    await this.db.update(users).set({ emailVerifiedAt: verifiedAt }).where(eq(users.id, id));
  }
}

export class DrizzleWorkspaceRepository {
  constructor(private readonly db: Db) {}

  async findBySlug(slug: string): Promise<WorkspaceRecord | null> {
    const rows = await this.db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    const row = rows[0];
    return row ? toWorkspace(row) : null;
  }

  async findById(id: string): Promise<WorkspaceRecord | null> {
    const rows = await this.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    const row = rows[0];
    return row ? toWorkspace(row) : null;
  }
}

export class DrizzleMembershipRepository {
  constructor(private readonly db: Db) {}

  async listForUser(
    userId: string,
  ): Promise<Array<{ workspace: WorkspaceRecord; role: MembershipRole }>> {
    const rows = await this.db
      .select({ workspace: workspaces, role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(eq(memberships.userId, userId))
      .orderBy(workspaces.createdAt);
    // role text column constrained to the MembershipRole vocabulary by input validation.
    return rows.map((row) => ({ workspace: toWorkspace(row.workspace), role: row.role as MembershipRole }));
  }
}

export class DrizzleRegistrationRepository {
  constructor(private readonly db: Db) {}

  /**
   * One transaction: user + personal workspace + owner membership (M1
   * acceptance). Unique violations bubble up as Postgres 23505 errors which
   * the identity service maps to AppError("CONFLICT").
   */
  async createAccount(input: {
    user: UserRecord;
    workspace: WorkspaceRecord;
    membership: {
      workspaceId: string;
      userId: string;
      role: MembershipRole;
    };
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: input.user.id,
        email: input.user.email,
        name: input.user.name,
        passwordHash: input.user.passwordHash,
        emailVerifiedAt: input.user.emailVerifiedAt,
        createdAt: input.user.createdAt,
      });
      await tx.insert(workspaces).values({
        id: input.workspace.id,
        name: input.workspace.name,
        slug: input.workspace.slug,
        plan: input.workspace.plan,
        stripeCustomerId: input.workspace.stripeCustomerId,
        stripeSubscriptionId: input.workspace.stripeSubscriptionId,
        createdAt: input.workspace.createdAt,
      });
      await tx.insert(memberships).values({
        workspaceId: input.membership.workspaceId,
        userId: input.membership.userId,
        role: input.membership.role,
      });
    });
  }
}
