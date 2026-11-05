// @formforge/core — identity module public interface (spec §3).
// Consumed as `@formforge/core/identity`.
export * from "./ports.js";
export * from "./password.js";
export * from "./schemas.js";
export * from "./service.js";

// INTEGRATION-DEBT: awaiting T02 — the shared kernel normally reaches consumers
// via the package root export. Until T02 lands src/shared/ + src/index.ts,
// re-export the bridge types here so web route handlers/actions can map errors
// per spec §4. After T02: point these re-exports at "../shared" or drop them.
export { AppError, errorBody } from "../bridge.js";
export type { AppErrorCode, AppErrorDetail, Ctx, Result } from "../bridge.js";
