/**
 * T10 — HTTP helpers for /api/v1 route handlers (spec §4).
 * Routes stay thin: map Result<AppError> to a response, nothing else.
 */
import { NextResponse } from 'next/server';
import { appErrorToHttpStatus, toApiErrorBody, type AppError } from '@formforge/core';

export function errorResponse(error: AppError): NextResponse {
  return NextResponse.json(toApiErrorBody(error), {
    status: appErrorToHttpStatus(error.code),
    headers: { 'cache-control': 'no-store' },
  });
}

export function jsonOk(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
