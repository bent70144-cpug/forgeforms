// @formforge/core — domain modules (spec §2/§3).
//
// OWNED BY T02 (issue #2): the shared kernel lives in src/shared/ and is
// re-exported here. Later tickets add their own module folders alongside and
// export them through this package root as well (spec §3).
export * from "./shared/ctx.ts";
export * from "./shared/result.ts";
export * from "./shared/errors.ts";
export * from "./shared/ids.ts";
export * from "./shared/logger.ts";
export * from "./shared/env.ts";
export * from "./shared/audit.ts";

// T13 (issue #13): logic engine — compile/evaluate/lint (pure, shared).
export * from "./logic/index.ts";

// T10 (issue #10): publish pipeline — versions, snapshots, unpublish→410.
export * from "./documents/index.ts";
