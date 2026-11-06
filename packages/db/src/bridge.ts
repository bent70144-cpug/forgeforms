// INTEGRATION-DEBT (lead, T03×T02 merge): thin compatibility shim over the REAL
// T02 schema/client. Re-exports the canonical tables so ticket #3 repositories
// compile unchanged. The `sessions` table was formalized into
// src/schema/identity.ts by T05 (see its header note) — this file now only
// re-exports it.
import { createDb, type Database } from "./client.ts";

export {
  users,
  workspaces,
  memberships,
  apiTokens,
  sessions,
  authTokens,
} from "./schema/identity.ts";
export { createDb, type Database };

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
