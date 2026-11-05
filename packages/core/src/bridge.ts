// INTEGRATION-DEBT: awaiting T02/T04
// T02 owns the real shared kernel (spec §4: AppError, Result, Ctx, ids, logger, env)
// in packages/core/src/shared/. Until it merges, T25 (issue #25) defines the minimal
// surface it needs HERE — this is the ONLY sanctioned bridge file. When T02 lands,
// delete this file and re-point imports to '@formforge/core'.
//
// Everything below mirrors spec §4 exactly (error codes ↔ HTTP statuses, Ctx with
// injected clock) so the swap should be mechanical.

/** Error codes per spec §4. */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PLAN_LIMIT'
  | 'INTERNAL';

/**
 * One AppError to rule them all (spec §4). API layer maps `code` → HTTP status:
 * NOT_FOUND 404, FORBIDDEN 403, VALIDATION 422, CONFLICT 409, RATE_LIMITED 429,
 * PLAN_LIMIT 402, INTERNAL 500. Auth failures (missing/invalid credentials)
 * use FORBIDDEN — spec §4 defines no separate 401 code.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: ReadonlyArray<{ path: string; message: string }>;

  constructor(code: ErrorCode, message: string, details?: ReadonlyArray<{ path: string; message: string }>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  /** HTTP status for this error per spec §4. */
  get httpStatus(): number {
    return httpStatusFor(this.code);
  }

  static notFound(message = 'Not found', details?: AppError['details']): AppError {
    return new AppError('NOT_FOUND', message, details);
  }
  static forbidden(message = 'Forbidden', details?: AppError['details']): AppError {
    return new AppError('FORBIDDEN', message, details);
  }
  static validation(message = 'Invalid input', details?: AppError['details']): AppError {
    return new AppError('VALIDATION', message, details);
  }
  static conflict(message = 'Conflict', details?: AppError['details']): AppError {
    return new AppError('CONFLICT', message, details);
  }
  static rateLimited(message = 'Rate limited', details?: AppError['details']): AppError {
    return new AppError('RATE_LIMITED', message, details);
  }
  static planLimit(message = 'Plan limit reached', details?: AppError['details']): AppError {
    return new AppError('PLAN_LIMIT', message, details);
  }
  static internal(message = 'Internal error', details?: AppError['details']): AppError {
    return new AppError('INTERNAL', message, details);
  }
}

/** spec §4 — API maps codes to HTTP status. UNAUTHORIZED is a bridge addition (401). */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION':
      return 422;
    case 'CONFLICT':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    case 'PLAN_LIMIT':
      return 402;
    case 'INTERNAL':
      return 500;
  }
}

/** Membership role per spec §6 (owned by T04). */
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** What authenticated the request (spec §11: session cookie OR bearer token). */
export type AuthActor =
  | { kind: 'session'; userId: string; role: Role }
  | { kind: 'token'; tokenId: string; scopes: readonly string[] }
  | { kind: 'system' };

/**
 * Request context threaded through every service. Time is injected (`ctx.now()`)
 * per spec §4 — never call `new Date()` inside services.
 */
export interface Ctx {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly actor: AuthActor;
  /** Convenience accessors derived from `actor`. */
  readonly userId: string | null;
  readonly role: Role | null;
  readonly scopes: readonly string[];
  /** Injected clock (spec §4). */
  now(): Date;
}

/** Result type per spec §4/M0 — services return Results, API maps to HTTP. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: AppError): Result<T> => ({ ok: false, error });

/** Factory for a `Ctx` in tests and simple call sites. */
export function makeCtx(input: {
  workspaceId: string;
  actor?: AuthActor;
  requestId?: string;
  now?: () => Date;
}): Ctx {
  const actor: AuthActor = input.actor ?? { kind: 'system' };
  return {
    workspaceId: input.workspaceId,
    requestId: input.requestId ?? crypto.randomUUID(),
    actor,
    userId: actor.kind === 'session' ? actor.userId : null,
    role: actor.kind === 'session' ? actor.role : null,
    scopes: actor.kind === 'token' ? actor.scopes : [],
    now: input.now ?? (() => new Date()),
  };
}
