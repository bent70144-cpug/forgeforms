/**
 * T10 — AppError → HTTP mapping (spec §4) and the §4 API error body shape.
 * Lives in core so worker jobs, ingest and the API routes share one table.
 */
import { AppError, type AppErrorCode } from "../shared/errors.ts";

// SPEC-NOTE: UNPUBLISHED → 410 is required by spec §8 / issue #10 ("unpublish
// → 410"); it extends the §4 code list until folded into the shared kernel.
const HTTP_STATUS: Readonly<Record<AppErrorCode, number>> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
  INTERNAL: 500,
  UNPUBLISHED: 410,
  // T27 AI-plane extensions (integration).
  UNAUTHENTICATED: 401,
  UNPROCESSABLE: 422,
  AI_OUTPUT_INVALID: 502,
  AI_PROVIDER_ERROR: 502,
  AI_NOT_CONFIGURED: 503,
  CONFIRMATION_REQUIRED: 422,
};

export function appErrorToHttpStatus(code: AppErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}

/** Spec §4 error body: `{ error: { code, message, details } }`. */
export function toApiErrorBody(error: AppError): {
  error: { code: AppErrorCode; message: string; details: ReadonlyArray<{ path?: string; message: string }> };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details.map((d) => (d.path === undefined ? { message: d.message } : { path: d.path, message: d.message })),
    },
  };
}
