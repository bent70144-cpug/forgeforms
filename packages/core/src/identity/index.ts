// @formforge/core — identity module public interface (spec §3).
// Consumed as `@formforge/core/identity`.
export * from "./ports";
export * from "./password";
export * from "./schemas";
export * from "./service";
export * from "./tokens";
export * from "./rate-limit";
export * from "./emails";
export * from "./recovery";
export * from "./oauth";

// INTEGRATION-DEBT: awaiting T02 — the shared kernel normally reaches consumers
// via the package root export. Until T02 lands src/shared/ + src/index.ts,
// re-export the bridge types here so web route handlers/actions can map errors
// per spec §4. After T02: point these re-exports at "../shared" or drop them.
export { AppError, errorBody } from "../shared/errors.ts";
export { type Ctx } from "../shared/ctx.ts";
export { type AppErrorCode, type ErrorDetail as AppErrorDetail } from "../shared/errors.ts";
export { type Result } from "../shared/result.ts";
