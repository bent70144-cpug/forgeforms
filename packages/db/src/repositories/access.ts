import { and, eq } from "drizzle-orm";
import { uuidv7, type Ctx } from "@formforge/core";
import type { Database } from "../client.ts";
import {
  apiTokens,
  memberships,
  users,
  workspaces,
  type ApiToken,
  type ApiTokenScope,
  type Membership,
  type MembershipRole,
  type NewApiToken,
  type NewMembership,
  type NewUser,
  type NewWorkspace,
  type User,
  type Workspace,
  type WorkspacePlan,
} from "../schema/identity.ts";

/**
 * Identity & tenancy repositories (spec §3/§6).
 *
 * Repositories live in `packages/db` and are the ONLY place tenant tables are
 * touched; only the owning module imports them. Every tenant-scoped function
 * takes `Ctx` first and filters by `ctx.workspaceId`; wall-clock time comes
 * exclusively from `ctx.now()`.
 *
 * SPEC-NOTE: M1 (issue #3+) wraps these in transactions that run
 * `set local app.workspace_id = …` to activate RLS; the function signatures
 * below are already RLS-ready (they never trust a client-supplied tenant id).
 */

export function createIdentityRepositories(db: Database) {
  return {
    users: {
      findById(id: string): Promise<User | undefined> {
        // Users are global (login plane) — not tenant-scoped by design.
        return db.select().from(users).where(eq(users.id, id)).limit(1).then((r) => r[0]);
      },
      findByEmail(email: string): Promise<User | undefined> {
        return db.select().from(users).where(eq(users.email, email)).limit(1).then((r) => r[0]);
      },
      async create(
        ctx: Ctx,
        values: Omit<NewUser, "id" | "createdAt"> & { id?: string },
      ): Promise<User> {
        const rows = await db
          .insert(users)
          .values({ ...values, id: values.id ?? uuidv7(ctx.now().getTime()), createdAt: ctx.now() })
          .returning();
        return rows[0]!;
      },
    },

    workspaces: {
      findById(id: string): Promise<Workspace | undefined> {
        return db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1).then((r) => r[0]);
      },
      async create(
        ctx: Ctx,
        values: Omit<NewWorkspace, "id" | "createdAt"> & { id?: string },
      ): Promise<Workspace> {
        const rows = await db
          .insert(workspaces)
          .values({
            ...values,
            id: values.id ?? uuidv7(ctx.now().getTime()),
            createdAt: ctx.now(),
          })
          .returning();
        return rows[0]!;
      },
      async updatePlan(ctx: Ctx, plan: WorkspacePlan): Promise<void> {
        await db.update(workspaces).set({ plan }).where(eq(workspaces.id, ctx.workspaceId));
      },
    },

    memberships: {
      listForWorkspace(ctx: Ctx): Promise<Membership[]> {
        return db
          .select()
          .from(memberships)
          .where(eq(memberships.workspaceId, ctx.workspaceId));
      },
      findRole(ctx: Ctx, userId: string): Promise<MembershipRole | undefined> {
        return db
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, ctx.workspaceId),
              eq(memberships.userId, userId),
            ),
          )
          .limit(1)
          .then((r) => r[0]?.role as MembershipRole | undefined);
      },
      async create(ctx: Ctx, values: Omit<NewMembership, "workspaceId">): Promise<Membership> {
        const rows = await db
          .insert(memberships)
          .values({ ...values, workspaceId: ctx.workspaceId })
          .returning();
        return rows[0]!;
      },
      async remove(ctx: Ctx, userId: string): Promise<void> {
        await db
          .delete(memberships)
          .where(
            and(
              eq(memberships.workspaceId, ctx.workspaceId),
              eq(memberships.userId, userId),
            ),
          );
      },
    },

    apiTokens: {
      listForWorkspace(ctx: Ctx): Promise<ApiToken[]> {
        return db.select().from(apiTokens).where(eq(apiTokens.workspaceId, ctx.workspaceId));
      },
      findByTokenHash(tokenHash: string): Promise<ApiToken | undefined> {
        // Token lookup happens on the unauthenticated plane, before a Ctx exists.
        return db
          .select()
          .from(apiTokens)
          .where(eq(apiTokens.tokenHash, tokenHash))
          .limit(1)
          .then((r) => r[0]);
      },
      async create(
        ctx: Ctx,
        values: { name: string; tokenHash: string; scopes: ApiTokenScope[] },
      ): Promise<ApiToken> {
        const insert: NewApiToken = {
          id: uuidv7(ctx.now().getTime()),
          workspaceId: ctx.workspaceId,
          name: values.name,
          tokenHash: values.tokenHash,
          scopes: [...values.scopes],
          createdAt: ctx.now(),
        };
        const rows = await db.insert(apiTokens).values(insert).returning();
        return rows[0]!;
      },
      async touchLastUsed(ctx: Ctx, tokenId: string): Promise<void> {
        await db
          .update(apiTokens)
          .set({ lastUsedAt: ctx.now() })
          .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.workspaceId, ctx.workspaceId)));
      },
    },
  };
}

export type IdentityRepositories = ReturnType<typeof createIdentityRepositories>;
