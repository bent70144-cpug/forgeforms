/**
 * INTEGRATION-DEBT: awaiting T02/T07.
 *
 * Minimal kernel surface (Ctx / Result / AppError) required by the T10 publish
 * pipeline until T02 lands `packages/core/src/shared/**` (spec §3/§4).
 *
 * SWAP PROCEDURE for the integrator: replace the bodies below with
 * `export * from './shared/kernel'` (or wherever T02 exposes Ctx/Result/AppError)
 * and delete this file. T10 module code imports these symbols ONLY through
 * `../bridge` / the documents `index.ts`, so this is a one-file change.
 *
 * Contract notes (kept faithful to spec §3/§4 so the swap is seamless):
 * - `Ctx` is exactly the shape from spec §3.
 * - `Result<T, E>` is `{ ok: true; value: T } | { ok: false; error: E }`.
 * - `AppError` carries `code` from the §4 list plus `message`/`details`.
 */
export type ActorType = 'user' | 'token' | 'mcp' | 'system';

/** Spec §3 — request context handed to every tenant-aware service. */
export type Ctx = {
  workspaceId: string;
  actor: { type: ActorType; id: string };
  requestId: string;
  now: () => Date;
};

/** Spec §3 — services return Result, never throw across module boundaries. */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Spec §4 — one error class with a `code` mapped to HTTP status by the API layer.
 *
 * SPEC-NOTE: `UNPUBLISHED` extends the §4 code list. §4 does not define a code for
 * the 410 Gone case, but §8 + issue #10 require "public URL returns 410" after
 * unpublish; T10 maps UNPUBLISHED → 410 in `appErrorToHttpStatus` and the lead
 * should fold it into the shared error module with T02.
 */
export type AppErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PLAN_LIMIT'
  | 'INTERNAL'
  | 'UNPUBLISHED';

/** Spec §4 — API error details entries (`{ path, message }`). */
export type AppErrorDetail = { path?: string; message: string };

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: readonly AppErrorDetail[];

  constructor(code: AppErrorCode, message: string, details: readonly AppErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  /** Duck-typed guard so a swapped-in T02 AppError still matches. */
  static is(value: unknown): value is AppError {
    return (
      value instanceof AppError ||
      (typeof value === 'object' &&
        value !== null &&
        (value as { name?: unknown }).name === 'AppError' &&
        typeof (value as { code?: unknown }).code === 'string')
    );
  }
}
