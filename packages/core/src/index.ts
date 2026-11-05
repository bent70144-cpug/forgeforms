// @formforge/core — domain modules (spec §2/§3).
//
// OWNED BY T02 (issue #2): the shared kernel lives in src/shared/ and is
// re-exported here. Later tickets add their own module folders
// (identity/, documents/, logic/, submissions/, ...) alongside and export
// them through this package root as well (spec §3: modules expose only
// index.ts).
export * from "./shared/ctx.ts";
export * from "./shared/result.ts";
export * from "./shared/errors.ts";
export * from "./shared/ids.ts";
export * from "./shared/logger.ts";
export * from "./shared/env.ts";
export * from "./shared/audit.ts";
