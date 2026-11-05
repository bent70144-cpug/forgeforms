// INTEGRATION-DEBT (lead, T03×T02 merge): thin compatibility shim over the REAL
// T02 schema/client. Re-exports the canonical tables so ticket #3 repositories
// compile unchanged; the only locally-defined table is `sessions` (spec §6
// lists none — DB-backed sessions per ticket #3 need it; formalize under
// src/schema/ with T05/hardening and delete it here).
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createDb, type Database } from "./client.ts";
import { apiTokens, memberships, users, workspaces } from "./schema/identity.ts";

export { users, workspaces, memberships, apiTokens } from "./schema/identity.ts";
export { createDb, type Database };

/** Local until formalized in src/schema/** (see header note). */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // sha256; raw token lives only in the cookie
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Node-postgres drizzle database handle (T02's canonical type). */
export type Db = Database;

/** Lazy singleton so importing this package never requires DATABASE_URL. */
let db: Database | undefined;

export function getDb(): Db {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — cannot connect to Postgres.");
    }
    db = createDb(connectionString);
  }
  return db;
}
