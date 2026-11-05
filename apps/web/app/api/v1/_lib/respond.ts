// Response + error mapping for /api/v1 (spec §4 conventions).
//
// Error body (exact §4 shape):
//   { "error": { "code", "message", "details": [{ "path", "message" }] } }
// Code → HTTP: NOT_FOUND 404, FORBIDDEN 403, VALIDATION 422, CONFLICT 409,
// RATE_LIMITED 429, PLAN_LIMIT 402, INTERNAL 500.
// Pagination envelope: { data: [...], nextCursor: string | null }.
//
// Plain `Response` objects (not NextResponse) keep this module framework-thin
// and unit-testable outside Next.js.

import { AppError, httpStatusFor, type ErrorCode } from '@formforge/core/api';

export const JSON_MEDIA = 'application/json';

type ErrorDetail = { path: string; message: string };

export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
  };
}

/** Build the §4 error body. */
export function apiErrorBody(
  code: ErrorCode,
  message: string,
  details?: readonly ErrorDetail[],
): ApiErrorBody {
  return { error: { code, message, ...(details && details.length > 0 ? { details } : {}) } };
}

/** JSON response with the given §4 code/status. */
export function jsonError(
  code: ErrorCode,
  message: string,
  details?: readonly ErrorDetail[],
  extraHeaders?: Record<string, string>,
): Response {
  const headers: Record<string, string> = { 'content-type': JSON_MEDIA, ...extraHeaders };
  if (code === 'RATE_LIMITED') {
    const retryAfter = details?.find((d) => d.path === 'retryAfter')?.message;
    if (retryAfter) headers['retry-after'] = retryAfter;
  }
  return new Response(JSON.stringify(apiErrorBody(code, message, details)), {
    status: httpStatusFor(code),
    headers,
  });
}

/** Minimal structural detection of a Zod error — avoids importing zod in apps/web. */
function isZodErrorLike(error: unknown): error is { name: 'ZodError'; issues: readonly { path: readonly PropertyKey[]; message: string }[] } {
  return (
    error instanceof Error &&
    error.name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function zodIssuesToDetails(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}

/** Structured JSON logging (spec §4). NEVER logs request bodies or tokens. */
function logInternal(requestId: string, error: unknown): void {
  const payload: Record<string, unknown> = {
    level: 'error',
    requestId,
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof Error && error.stack) payload.stack = error.stack;
  console.error(JSON.stringify(payload));
}

/**
 * Map any thrown value to a §4 error response:
 *  - AppError → its code/status;
 *  - ZodError (from schema `.parse()`) → 422 VALIDATION with field details;
 *  - anything else → 500 INTERNAL (message logged, not leaked to the client).
 */
export function handleApiError(error: unknown, context?: { requestId?: string }): Response {
  const requestId = context?.requestId ?? crypto.randomUUID();
  if (error instanceof AppError) {
    return jsonError(error.code, error.message, error.details ? [...error.details] : undefined);
  }
  if (isZodErrorLike(error)) {
    return jsonError('VALIDATION', 'Invalid input', zodIssuesToDetails(error));
  }
  logInternal(requestId, error);
  return jsonError('INTERNAL', 'Internal error');
}

/** 200 with a JSON body. */
export function ok<T>(data: T, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': JSON_MEDIA, ...extraHeaders },
  });
}

/** 201 with a JSON body. */
export function created<T>(data: T): Response {
  return new Response(JSON.stringify(data), {
    status: 201,
    headers: { 'content-type': JSON_MEDIA },
  });
}

/** 204 — no body. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** spec §4 pagination envelope. */
export function listResponse<T>(data: readonly T[], nextCursor: string | null): Response {
  return ok({ data, nextCursor });
}
