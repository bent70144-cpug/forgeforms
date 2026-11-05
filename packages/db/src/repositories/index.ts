// Repositories skeleton (spec §3/§6).
//
// OWNED BY T02 for the file layout; later tickets (identity, documents, ...)
// ADD their own `*.repository.ts` files here — they must never touch
// src/schema/**. Rules that hold for every repository file:
//   - only the owning core module imports a repository;
//   - every tenant-scoped function takes `Ctx` first and filters by
//     `ctx.workspaceId`;
//   - time comes from `ctx.now()`, never `new Date()`.
export * from "./identity.ts";
