// packages/core/src/bridge.ts
// INTEGRATION-DEBT: awaiting T02/T04 — minimal kernel seam so parallel tickets
// (T23 billing et al.) can compile before the T02 kernel lands in src/shared/.
// This file must stay tiny and is expected to be DELETED once T02's kernel
// exports { Ctx, Result, AppError, ok, err } from '@formforge/core'.
// NEVER edit packages/core/src/shared/** — that directory belongs to T02.

/** Kernel error codes (spec §4). API layers map these to HTTP statuses
 * (404, 403, 422, 409, 429, 402, 500). */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PLAN_LIMIT'
  | 'INTERNAL';

/** One error class per spec §4: `code`, `message`, `details`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details ?? null;
  }
}

/** Services return `Result<T, AppError>` — no thrown errors across module
 * boundaries except for programmer errors (spec §3). */
export type Result<T, E extends AppError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Request context (spec §3). Every service that touches tenant data takes a
 * `Ctx` first and scopes queries by `ctx.workspaceId`. */
export type Ctx = {
  workspaceId: string;
  actor: { type: 'user' | 'token' | 'mcp' | 'system'; id: string };
  requestId: string;
  now: () => Date;
};
