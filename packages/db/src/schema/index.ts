// Drizzle schema barrel (spec §2/§6). drizzle.config.ts points here.
export * from "./identity.ts";
// T04 (issue #4): tenancy tables for the document/submission plane (RLS +
// tenant-scoped repositories). NEW file; identity.ts untouched.
export * from "./tenancy.ts";
// T07 (issue #7): documents, document_versions, snapshots.
export * from "./documents.ts";
