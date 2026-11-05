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

/** spec §4 — error code → HTTP status. */
export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
  INTERNAL: 500,
};
