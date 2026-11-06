// Database client factory (spec §1: Drizzle ORM + node-postgres).
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.ts";

/** The app-wide database handle, typed against the full schema. */
export type Database = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): Database {
  return drizzle(connectionString, { schema });
}

/** Lazy singleton so importing this package never requires DATABASE_URL. ISSUE #30: moved from the retired bridge.ts. */
let db: Database | undefined;

export function getDb(): Database {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — cannot connect to Postgres.");
    }
    db = createDb(connectionString);
  }
  return db;
}
