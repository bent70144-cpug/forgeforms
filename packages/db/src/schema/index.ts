// Drizzle schema barrel (spec §2/§6). drizzle.config.ts points here.
// OWNED BY T02: only add NEW schema files when the issue body lists them.
export * from "./identity.ts";
// T04 (issue #4): tenancy tables for the document/submission plane (RLS +
// tenant-scoped repositories). NEW file; identity.ts untouched.
export * from "./tenancy.ts";
