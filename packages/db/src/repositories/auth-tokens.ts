// Drizzle auth-token repository (ticket #5) — single-use password reset +
// email verification tokens, sha256 at rest, atomic compare-and-set consume.
import { and, eq, isNull } from "drizzle-orm";
import type { AuthTokenKind, AuthTokenRecord } from "@formforge/core/identity";
import type { Db } from "../bridge";
import { authTokens } from "../bridge";

function toRecord(row: typeof authTokens.$inferSelect): AuthTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as AuthTokenKind,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleAuthTokenRepository {
  constructor(private readonly db: Db) {}

  async create(token: AuthTokenRecord): Promise<void> {
    await this.db.insert(authTokens).values({
      id: token.id,
      userId: token.userId,
      kind: token.kind,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      consumedAt: token.consumedAt,
      createdAt: token.createdAt,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AuthTokenRecord | null> {
    const rows = await this.db
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  /**
   * Atomic single-use (compare-and-set):
   * UPDATE auth_tokens SET consumed_at = $2
   *  WHERE token_hash = $1 AND consumed_at IS NULL — first caller wins.
   */
  async consumeByTokenHash(tokenHash: string, consumedAt: Date): Promise<boolean> {
    const updated = await this.db
      .update(authTokens)
      .set({ consumedAt })
      .where(and(eq(authTokens.tokenHash, tokenHash), isNull(authTokens.consumedAt)))
      .returning({ id: authTokens.id });
    return updated.length > 0;
  }

  /** Invalidate outstanding tokens of one kind (re-requested reset/verify). */
  async deleteUnconsumedByUser(userId: string, kind: AuthTokenKind, _at: Date): Promise<number> {
    const deleted = await this.db
      .delete(authTokens)
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.kind, kind),
          isNull(authTokens.consumedAt),
        ),
      )
      .returning({ id: authTokens.id });
    return deleted.length;
  }
}
