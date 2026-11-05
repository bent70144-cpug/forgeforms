// @formforge/core — domain modules (spec §2/§3).
// OWNED BY T02 (issue #2): shared kernel (Ctx, Result, AppError, ids, logger, env)
// lands in src/shared/. Later tickets add their own module folders
// (identity/, documents/, logic/, submissions/, ...).
export {};

// T10 (issue #10): publish pipeline — versions, snapshots, unpublish→410.
// Additive export; T02 should fold this into the final module barrel.
export * from './documents/index';
