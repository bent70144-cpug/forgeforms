<<<<<<< HEAD
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
  // SPEC-NOTE (T10): §4 does not define a code for unpublish; T10 maps
  // UNPUBLISHED → 410 in its own appErrorToHttpStatus mapper.
  | "UNPUBLISHED"
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
=======
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
>>>>>>> ticket/10-publish-pipeline
  requestId: string;
  now: () => Date;
};

<<<<<<< HEAD
/** Spec §4 API error body shape. */
export function errorBody(error: AppError): {
  error: { code: AppErrorCode; message: string; details: AppErrorDetail[] };
} {
  return { error: { code: error.code, message: error.message, details: error.details } };
}

// These are *structural* (duck-typed) types on purpose: the logic engine is a
// pure function library that must never throw on half-validated input
// (issue #13: "evaluate() never throws on malformed routing"). T06's Zod
// schemas remain the single source of truth at the document boundary.

/** Comparison operators supported by rule conditions (spec §7 `Rule.when`). */
export type RuleConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "isEmpty"
  | "matches";

/**
 * One condition of a rule. Conditions inside a rule are implicitly ANDed.
 * `left` is an operand reference: `@block:<id>` | `@var:<name>` | `@hidden:<name>`.
 */
export interface RuleCondition {
  left: string;
  op: RuleConditionOp;
  right?: unknown;
}

/** Actions a matching rule performs, in array order. */
export type RuleAction =
  | { type: "goto"; target: string } // blockId | `end:<endingId>`
  | { type: "set"; var: string; value: unknown };

/** A logic rule (spec §7 `Rule`). */
export interface Rule {
  id: string;
  /** blockId this rule runs after, or `"start"` for pre-first-block rules. */
  scope: string;
  when: RuleCondition[];
  then: RuleAction[];
  /** `"in all other cases"` rule: has empty `when`, runs only if nothing matched. */
  isFallback?: boolean;
}

/** Block document node (spec §7 `Block`). */
export interface Block {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[];
  hidden?: boolean;
=======
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
>>>>>>> ticket/10-publish-pipeline
}
