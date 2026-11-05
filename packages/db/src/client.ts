// Database client factory (spec §1: Drizzle ORM + node-postgres).
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.ts";

/** The app-wide database handle, typed against the full schema. */
export type Database = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): Database {
  return drizzle(connectionString, { schema });
}
