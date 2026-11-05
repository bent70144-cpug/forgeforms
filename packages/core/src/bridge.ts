// INTEGRATION-DEBT: awaiting T02 — temporary stand-in for the shared kernel
// that T02 (issue #2) owns under packages/core/src/shared/ (ctx.ts, result.ts,
// errors.ts, ids.ts). Public names and shapes follow spec §3/§4 exactly so the
// swap is mechanical:
//   1. delete this file,
//   2. re-point `../bridge` imports in src/identity/** to `../shared`,
//   3. re-export the kernel from the package root (src/index.ts).
// Nothing else in the identity module needs to change.

/** Error codes per spec §4; API maps them to HTTP 404/403/422/409/429/402/500. */
export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "INTERNAL";

/** Field-level detail for validation errors (spec §4 error body). */
export type AppErrorDetail = { path: string; message: string };

/** Single error class per spec §4. Never thrown across module boundaries. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: AppErrorDetail[];

  constructor(code: AppErrorCode, message: string, details: AppErrorDetail[] = []) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

/** Spec §3: services return Result<T, AppError> instead of throwing. */
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Spec §3 module contract. Every tenant-data service takes a Ctx first. */
export type Ctx = {
  workspaceId: string;
  actor: { type: "user" | "token" | "mcp" | "system"; id: string };
  requestId: string;
  now: () => Date;
};

/** Spec §4 API error body shape. */
export function errorBody(error: AppError): {
  error: { code: AppErrorCode; message: string; details: AppErrorDetail[] };
} {
  return { error: { code: error.code, message: error.message, details: error.details } };
}
