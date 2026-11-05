// Drizzle session repository (ticket #3) — opaque session tokens, sha256 at
// rest, sliding expiry via `touch`.
//
// INTEGRATION-DEBT: awaiting T02 — table + Db come from ../bridge.ts until
// T02's src/schema/** and client land.
import { eq } from "drizzle-orm";
import type { Db } from "../bridge.js";
import { sessions, users } from "../bridge.js";

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

export type UserRecord = {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

function toSession(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

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

export class DrizzleSessionRepository {
  constructor(private readonly db: Db) {}

  async create(session: SessionRecord): Promise<void> {
    await this.db.insert(sessions).values({
      id: session.id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    });
  }

  async findWithUserByTokenHash(
    tokenHash: string,
  ): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    const rows = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { session: toSession(row.session), user: toUser(row.user) };
  }

  /** Sliding expiry: extend the session's lifetime. */
  async touch(id: string, expiresAt: Date): Promise<void> {
    await this.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  }

  async deleteByTokenHash(tokenHash: string): Promise<boolean> {
    const deleted = await this.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .returning({ id: sessions.id });
    return deleted.length > 0;
  }
}
