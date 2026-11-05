// INTEGRATION-DEBT: awaiting T02/T14 — this is the ONLY bridge file for T17.
//
// T02 (issue #2) owns the real shared kernel in `packages/core/src/shared/**`
// (Ctx, Result, AppError, ids, logger) and T14 (issue #14) owns ingest, which
// emits `submission.completed`. Neither has landed yet, so T17 (issue #17)
// compiles against these minimal kernel contracts instead.
//
// When T02 lands:
//   1. swap imports of `@formforge/core/bridge` for `@formforge/core`,
//   2. delete this file (or reduce it to `export * from "./shared"`).
// The shapes below mirror spec §3 (`packages/core/src/shared/ctx.ts`) verbatim
// so the swap is mechanical.

/** Error codes per spec §4. */
export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "INTERNAL";

/** One error class per spec §4. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

/** Services return `Result<T, AppError>` — no thrown errors across module boundaries (spec §3). */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Request context per spec §3. Injected `now()` clock — never `new Date()` inside services. */
export type Ctx = {
  workspaceId: string;
  actor: { type: "user" | "token" | "mcp" | "system"; id: string };
  requestId: string;
  now: () => Date;
};
