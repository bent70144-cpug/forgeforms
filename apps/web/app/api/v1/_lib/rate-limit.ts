// In-memory sliding-window rate limiter (issue #25, spec §11):
//   600 req/min per API token, 300 req/min per session.
//
// INTEGRATION-DEBT: awaiting W1 infra — spec's production limiter is Redis-
// backed (BullMQ's Redis). This per-instance fallback bounds memory and keeps
// the /api/v1 contract (429 RATE_LIMITED + Retry-After) intact; swap the
// storage behind `rateLimit` when the shared Redis client lands.

import { AppError } from '@formforge/core/api';

export const TOKEN_RATE_LIMIT_PER_MINUTE = 600;
export const SESSION_RATE_LIMIT_PER_MINUTE = 300;
export const WINDOW_MS = 60_000;

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Seconds until the oldest in-window hit expires (for Retry-After). */
  readonly retryAfterSec: number;
  readonly remaining: number;
}

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

export function rateLimit(key: string, limit: number, now: () => number = Date.now): RateLimitResult {
  const currentTime = now();
  const windowStart = currentTime - WINDOW_MS;

  // Opportunistic GC to bound memory (INTEGRATION-DEBT: Redis replaces this).
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, hits] of buckets) {
      const alive = hits.filter((t) => t > windowStart);
      if (alive.length === 0) buckets.delete(k);
      else buckets.set(k, alive);
    }
  }

  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    const oldest = Math.min(...hits);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - currentTime) / 1000));
    buckets.set(key, hits);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }
  hits.push(currentTime);
  buckets.set(key, hits);
  return { allowed: true, retryAfterSec: 0, remaining: limit - hits.length };
}

/** Throws RATE_LIMITED (429) with a `retryAfter` detail the responder maps to Retry-After. */
export function assertRateLimit(key: string, limit: number, now: () => number = Date.now): void {
  const result = rateLimit(key, limit, now);
  if (!result.allowed) {
    throw AppError.rateLimited(`Rate limit exceeded: ${limit} requests per minute`, [
      { path: 'retryAfter', message: String(result.retryAfterSec) },
    ]);
  }
}
