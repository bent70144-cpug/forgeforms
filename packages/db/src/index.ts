// @formforge/db — drizzle schema, migrations, repositories (spec §2/§6).
//
// OWNED BY T02 (issue #2): src/schema/** (identity first), the drizzle-kit
// pipeline (drizzle.config.ts + drizzle/), and the src/repositories/** layout.
export * from "./schema/index.ts";
export { createDb, type Database } from "./client.ts";
export {
  createIdentityRepositories,
  type IdentityRepositories,
} from "./repositories/access.ts";

// T10 (issue #10): document_versions repository (insert-only, immutable rows).
export * from "./repositories/document-versions.ts";
