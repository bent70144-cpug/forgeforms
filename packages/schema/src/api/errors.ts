// API error envelope (spec §4) — the single error shape for /api/v1.
// T25 (issue #25) owns packages/schema/src/api/**; T06 owns the package index.
import { z } from 'zod';

export const ERROR_CODES = [
  'NOT_FOUND',
  'FORBIDDEN',
  'VALIDATION',
  'CONFLICT',
  'RATE_LIMITED',
  'PLAN_LIMIT',
  'INTERNAL',
  // SPEC-NOTE (T10): §4 has no code for unpublish; mapped to 410 by callers.
  'UNPUBLISHED',
  // SPEC-NOTE (T27): AI-plane extensions (see apps/web/api mapping).
  'UNAUTHENTICATED',
  'UNPROCESSABLE',
  'AI_OUTPUT_INVALID',
  'AI_PROVIDER_ERROR',
  'AI_NOT_CONFIGURED',
  'CONFIRMATION_REQUIRED',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ErrorDetailSchema = z.object({
  path: z.string().describe('Field path of the problem, e.g. "blocks[2].props.title"'),
  message: z.string().describe('Human-readable problem description'),
});

export const ErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.array(ErrorDetailSchema).optional(),
  }),
});

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** spec §4 (with T10/T27 extensions) — error code → HTTP status. Mirrors packages/core/src/shared/errors.ts. */
export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
  INTERNAL: 500,
  UNPUBLISHED: 410,
  UNAUTHENTICATED: 401,
  UNPROCESSABLE: 422,
  AI_OUTPUT_INVALID: 502,
  AI_PROVIDER_ERROR: 502,
  AI_NOT_CONFIGURED: 503,
  CONFIRMATION_REQUIRED: 422,
};
