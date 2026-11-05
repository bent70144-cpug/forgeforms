// Real-Postgres integration test for the auth-token repository (ticket #5).
// GATED: skipped unless RUN_DB_TESTS is set — the sandbox has no live
// Postgres; CI (docker-compose stack) runs it with `RUN_DB_TESTS=1`.
// Flow under test matches the acceptance criteria: single-use consume (CAS),
// per-user invalidation, hash-update + verified-at column updates.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, memberships, users, workspaces } from "../bridge";
import { DrizzleAuthTokenRepository } from "./auth-tokens";
import { DrizzleUserRepository } from "./identity";
import { DrizzleSessionRepository } from "./sessions";

const db = process.env.RUN_DB_TESTS && process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;

describe.skipIf(!process.env.RUN_DB_TESTS)("DrizzleAuthTokenRepository (live Postgres)", () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();

  beforeAll(async () => {
    if (!db) return;
    await migrate(db, { migrationsFolder: join(import.meta.dirname, "..", "..", "drizzle") });
    // Seed a user + workspace (auth_tokens.user_id has a cascade FK to users).
    await db.insert(users).values({
      id: userId,
      email: `t05-${userId}@example.com`,
      name: "T05 Fixture",
      passwordHash: null,
      emailVerifiedAt: null,
      createdAt: new Date(),
    });
    await db.insert(workspaces).values({
      id: workspaceId,
      name: "T05 Workspace",
      slug: `t05-${userId.slice(0, 8)}`,
      plan: "free",
      createdAt: new Date(),
    });
    await db.insert(memberships).values({ workspaceId, userId, role: "owner" });
  });

  afterAll(async () => {
    if (!db) return;
    // Cascades clean up tokens + sessions via users.
    await db.delete(users).where(eq(users.id, userId));
  });

  it("create → findByTokenHash → consume (single-use) end to end", async () => {
    if (!db) return;
    const tokens = new DrizzleAuthTokenRepository(db);
    const now = new Date();
    const tokenHash = `hash-${randomUUID()}`;

    await tokens.create({
      id: randomUUID(),
      userId,
      kind: "password_reset",
      tokenHash,
      expiresAt: new Date(now.getTime() + 3_600_000),
      consumedAt: null,
      createdAt: now,
    });

    const found = await tokens.findByTokenHash(tokenHash);
    expect(found?.userId).toBe(userId);
    expect(found?.kind).toBe("password_reset");
    expect(found?.consumedAt).toBeNull();

    const at = new Date(now.getTime() + 1000);
    expect(await tokens.consumeByTokenHash(tokenHash, at)).toBe(true); // first use wins
    expect(await tokens.consumeByTokenHash(tokenHash, at)).toBe(false); // CAS: second loses
    expect((await tokens.findByTokenHash(tokenHash))?.consumedAt).toEqual(at);
  });

  it("deleteUnconsumedByUser only removes outstanding tokens of the given kind", async () => {
    if (!db) return;
    const tokens = new DrizzleAuthTokenRepository(db);
    const now = new Date();
    const outstanding = `hash-out-${randomUUID()}`;
    const consumedHash = `hash-done-${randomUUID()}`;
    const verifyHash = `hash-verify-${randomUUID()}`;

    await tokens.create({
      id: randomUUID(), userId, kind: "password_reset", tokenHash: outstanding,
      expiresAt: new Date(now.getTime() + 3_600_000), consumedAt: null, createdAt: now,
    });
    await tokens.create({
      id: randomUUID(), userId, kind: "password_reset", tokenHash: consumedHash,
      expiresAt: new Date(now.getTime() + 3_600_000), consumedAt: now, createdAt: now,
    });
    await tokens.create({
      id: randomUUID(), userId, kind: "email_verify", tokenHash: verifyHash,
      expiresAt: new Date(now.getTime() + 86_400_000), consumedAt: null, createdAt: now,
    });

    const deleted = await tokens.deleteUnconsumedByUser(userId, "password_reset", now);
    expect(deleted).toBe(1); // outstanding reset only; consumed + verify survive
    expect(await tokens.findByTokenHash(consumedHash)).not.toBeNull();
    expect(await tokens.findByTokenHash(verifyHash)).not.toBeNull();
  });

  it("user repo updates password hash + verified-at; session repo revokes per user", async () => {
    if (!db) return;
    const repo = new DrizzleUserRepository(db);
    const now = new Date();
    await repo.setPasswordHash(userId, "argon2id-fake-hash");
    expect((await repo.findById(userId))?.passwordHash).toBe("argon2id-fake-hash");
    await repo.markEmailVerified(userId, now);
    expect((await repo.findById(userId))?.emailVerifiedAt).toEqual(now);

    const sessions = new DrizzleSessionRepository(db);
    expect(await sessions.deleteForUser(userId)).toBe(0); // no sessions for the fixture user
  });
});
