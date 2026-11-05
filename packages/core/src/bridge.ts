// INTEGRATION-DEBT: awaiting T02 (issue #2) — this file is a temporary stand-in
// for the shared kernel that T02 owns under src/shared/ (Ctx, Result, AppError).
// T19 (issue #19) must not edit src/shared/**, so these minimal, structurally
// compatible types live here. When T02 lands, DELETE this file and rewrite the
// imports in src/analytics/** to '@formforge/core' (or relative src/shared paths).
// The shapes below intentionally mirror spec §4 so the swap is mechanical.

/** Error codes per spec §4. */
export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "INTERNAL";

/** One error class per spec §4; API layer maps `code` → HTTP status. */
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

/**
 * Injected request/execution context (spec §4: "Use the injected `ctx.now()`,
 * never `new Date()` inside services").
 */
export interface Ctx {
  now(): Date;
  requestId?: string;
  workspaceId?: string;
}

/** Result type (spec §3 kernel contract). */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });
