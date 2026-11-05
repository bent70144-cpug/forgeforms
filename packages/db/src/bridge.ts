// INTEGRATION-DEBT: awaiting T02 — temporary stand-in for the Drizzle schema
// and DB client that T02 (issue #2) owns (packages/db/src/schema/**, client,
// drizzle.config.ts). Ticket #3 needs `users`, `workspaces`, `memberships`
// (spec §6) plus a `sessions` table (spec §6 lists none — DB-backed sessions
// per ticket #3 require it; T02 should formalize it under src/schema/).
//
// When T02 lands:
//   1. delete this file,
//   2. re-point `../bridge` imports in src/repositories/** to "../schema" and
//      the client to T02's exported db factory,
//   3. drop the getDb() re-export from src/repositories/index.ts.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { Pool } from "pg";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  // SPEC-NOTE: spec §6 uses citext; text + lowercase normalization in the
  // identity service until T02 lands the citext custom type.
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("free"), // free | pro | business
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(), // owner | admin | editor | viewer
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // sha256; raw token lives only in the cookie
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Node-postgres drizzle database handle. */
export type Db = NodePgDatabase<Record<string, never>>;

let pool: Pool | undefined;

/**
 * INTEGRATION-DEBT: awaiting T02 — lazy singleton standing in for T02's client
 * module. Lazy so importing this package never requires DATABASE_URL (keeps
 * `next build` green in environments without a database).
 */
export function getDb(): Db {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — cannot connect to Postgres.");
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return drizzle(pool);
}
