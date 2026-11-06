/**
 * T10 — AppError → HTTP mapping per spec §4 (+ UNPUBLISHED → 410 per §8).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from "../../shared/errors.ts";;
import { appErrorToHttpStatus, toApiErrorBody } from '../errors';

describe('appErrorToHttpStatus (spec §4)', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['FORBIDDEN', 403],
    ['VALIDATION', 422],
    ['CONFLICT', 409],
    ['RATE_LIMITED', 429],
    ['PLAN_LIMIT', 402],
    ['INTERNAL', 500],
    ['UNPUBLISHED', 410], // SPEC-NOTE: §8 requires 410 after unpublish
  ] as const)('maps %s → %i', (code, status) => {
    expect(appErrorToHttpStatus(code)).toBe(status);
  });

  it('falls back to 500 for unknown codes', () => {
    expect(appErrorToHttpStatus('SOMETHING_ELSE' as never)).toBe(500);
  });
});

describe('toApiErrorBody (spec §4 error body shape)', () => {
  it('emits { error: { code, message, details } }', () => {
    const error = new AppError('VALIDATION', 'Invalid input', [
      { path: 'blocks[2].props.title', message: 'Required' },
      { message: 'slug already taken' },
    ]);
    expect(toApiErrorBody(error)).toEqual({
      error: {
        code: 'VALIDATION',
        message: 'Invalid input',
        details: [
          { path: 'blocks[2].props.title', message: 'Required' },
          { message: 'slug already taken' },
        ],
      },
    });
  });

  it('AppError.is guards duck-typed errors', () => {
    expect(AppError.is(new AppError('NOT_FOUND', 'x'))).toBe(true);
    expect(AppError.is(new Error('plain'))).toBe(false);
    expect(AppError.is(null)).toBe(false);
  });
});
