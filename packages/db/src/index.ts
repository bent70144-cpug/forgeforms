// @formforge/db — drizzle schema, migrations, repositories (spec §2/§6).
// OWNED BY T02 (issue #2): drizzle.config.ts, src/schema/** (identity first),
// migration pipeline, seed script. Later tickets add NEW files under
// src/repositories/** — they must not touch src/schema/**.
export {};

// T10 (issue #10): document_versions repository (insert-only, immutable rows).
// Additive export; T02 should fold this into the final module barrel.
export * from './repositories/document-versions';
