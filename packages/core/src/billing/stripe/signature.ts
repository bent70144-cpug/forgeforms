// packages/core/src/billing/stripe/signature.ts
// Stripe webhook signature scheme (v1) implemented with node:crypto — no SDK.
//   Stripe-Signature: t=<unix seconds>,v1=<hex hmac>,v1=<hex hmac>...
//   signed_payload = `${t}.${rawBody}`
//   expected v1    = HMAC-SHA256(secret, signed_payload) as lowercase hex
// The raw body MUST be the exact bytes Stripe sent (hence route uses
// req.text() on the untouched request). Tolerance check protects against
// replayed deliveries.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ok, err, type Result, AppError } from '../../bridge';

export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Build a `Stripe-Signature` header value. Exported for tests and for
 * worker-side fixtures — production verification never needs it. */
export function signStripePayload(
  rawBody: string,
  secret: string,
  timestampSeconds: number,
): string {
  const expected = hmacHex(rawBody, secret, timestampSeconds);
  return `t=${timestampSeconds},v1=${expected}`;
}

/** Convenience wrapper: timestamp in ms (ctx.now()-style). */
export function signStripeEvent(rawBody: string, secret: string, timestampMs: number): string {
  return signStripePayload(rawBody, secret, Math.floor(timestampMs / 1000));
}

function hmacHex(rawBody: string, secret: string, timestampSeconds: number): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
}

export type VerifyOptions = {
  nowMs?: number;
  toleranceSeconds?: number;
};

/** Verify a Stripe-Signature header against the raw body.
 * - VALIDATION error: missing/malformed header
 * - VALIDATION error: timestamp outside tolerance (replayed delivery)
 * - VALIDATION error: no v1 digest matches (tampered body / wrong secret) */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: VerifyOptions = {},
): Result<{ timestampSeconds: number }, AppError> {
  const parsed = parseHeader(signatureHeader);
  if (!parsed.ok) return parsed;

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - parsed.value.timestampSeconds) > tolerance) {
    return err(
      new AppError(
        'VALIDATION',
        `Stripe-Signature timestamp outside tolerance of ${tolerance}s (possible replay)`,
        [
          { path: 'timestampSeconds', message: String(parsed.value.timestampSeconds) },
          { path: 'nowSeconds', message: String(nowSeconds) },
        ],
      ),
    );
  }

  const expected = hmacHex(rawBody, secret, parsed.value.timestampSeconds);
  for (const candidate of parsed.value.v1Signatures) {
    if (safeHexEqual(candidate, expected)) {
      return ok({ timestampSeconds: parsed.value.timestampSeconds });
    }
  }
  return err(new AppError('VALIDATION', 'Stripe-Signature digest mismatch'));
}

type ParsedHeader = { timestampSeconds: number; v1Signatures: string[] };

function parseHeader(header: string): Result<ParsedHeader, AppError> {
  let timestampSeconds: number | null = null;
  const v1Signatures: string[] = [];

  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === 't') {
      const t = Number(value);
      if (!Number.isInteger(t) || t < 0) {
        return err(new AppError('VALIDATION', `Malformed Stripe-Signature timestamp "${value}"`));
      }
      timestampSeconds = t;
    } else if (key === 'v1') {
      v1Signatures.push(value.toLowerCase());
    }
  }

  if (timestampSeconds === null || v1Signatures.length === 0) {
    return err(new AppError('VALIDATION', 'Malformed Stripe-Signature header'));
  }
  return ok({ timestampSeconds, v1Signatures });
}

function safeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
