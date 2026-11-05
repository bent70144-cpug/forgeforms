// Seed script (stub — ticket T02 / issue #2).
//
// Seeds a demo identity set: one user, one workspace ("demo"), an owner
// membership. Idempotent: re-running skips already-seeded rows.
//
// Run: `pnpm --filter @formforge/db seed` (needs a live Postgres, i.e.
// `docker compose up -d postgres`, and DATABASE_URL in the environment).
//
// SPEC-NOTE: password_hash would be argon2id (spec §1) — argon2 lands with
// the identity module (M1); this stub stores no passwords.

import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log("[seed] DATABASE_URL is not set — nothing to do (sandbox has no Postgres).");
  process.exit(0);
}

const { createDb } = await import("./client.ts");
const { memberships, users, workspaces } = await import("./schema/identity.ts");
const { uuidv7 } = await import("@formforge/core");

const db = createDb(DATABASE_URL);
const now = new Date();

async function seed(): Promise<void> {
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "demo"))
    .limit(1);
  if (existing[0]) {
    console.log(`[seed] workspace "demo" already exists (${existing[0].id}) — nothing to do.`);
    return;
  }

  const [user] = await db
    .insert(users)
    .values({ id: uuidv7(now.getTime()), email: "demo@formforge.test", name: "Demo User" })
    .returning();
  if (!user) throw new Error("[seed] failed to insert demo user");

  const [workspace] = await db
    .insert(workspaces)
    .values({ id: uuidv7(now.getTime()), name: "Demo Workspace", slug: "demo" })
    .returning();
  if (!workspace) throw new Error("[seed] failed to insert demo workspace");

  await db
    .insert(memberships)
    .values({ workspaceId: workspace.id, userId: user.id, role: "owner" });

  console.log(`[seed] created user ${user.email} and workspace "${workspace.slug}" (${workspace.id}).`);
}

seed().catch((error: unknown) => {
  const code =
    error instanceof Error && "cause" in error && error.cause instanceof AggregateError
      ? (error.cause.errors[0] as { code?: string } | undefined)?.code
      : undefined;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    console.error("[seed] cannot reach Postgres — is it running? (`docker compose up -d postgres`)");
  } else {
    console.error("[seed] failed:", error);
  }
  process.exit(1);
});
