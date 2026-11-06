// In-memory sliding-window rate limiter for auth flows (spec §17: "login and
// reset rate limited"; ticket #5: per IP+email).
//
// Implemented behind the `RateLimiter` interface so production can swap the
// storage for Redis (INTEGRATION-DEBT) without touching call sites — the same
// shape as the /api/v1 per-instance limiter in apps/web. Keys are built by the
// caller as `${ip}:${email}`; the limiter itself is key-agnostic.
export interface RateLimiterClock {
  nowMs(): number;
}

export type RateLimitDecision = {
  allowed: boolean;
  /** Hits still available in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the oldest in-window hit drains (for Retry-After). 0 when allowed. */
  retryAfterSec: number;
};

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

export type RateLimiterOptions = {
  /** Max hits per key per window. */
  limit: number;
  /** Sliding window size in ms. */
  windowMs: number;
  /** Injectable clock — defaults to Date.now (tests inject a fake). */
  clock?: RateLimiterClock;
  /** Soft cap on tracked keys (opportunistic GC when exceeded). */
  maxKeys?: number;
};

export function createInMemoryRateLimiter(options: RateLimiterOptions): RateLimiter & { size(): number } {
  const { limit, windowMs } = options;
  const clock = options.clock ?? { nowMs: () => Date.now() };
  const maxKeys = options.maxKeys ?? 10_000;
  const buckets = new Map<string, number[]>();

  const limiter: RateLimiter & { size(): number } = {
    check(key: string): RateLimitDecision {
      const now = clock.nowMs();
      const windowStart = now - windowMs;

      // Opportunistic GC (INTEGRATION-DEBT: Redis replaces this in prod).
      if (buckets.size > maxKeys) {
        for (const [k, hits] of buckets) {
          const alive = hits.filter((t) => t > windowStart);
          if (alive.length === 0) buckets.delete(k);
          else buckets.set(k, alive);
        }
      }

      const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
      if (hits.length >= limit) {
        const oldest = Math.min(...hits);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }
      hits.push(now);
      buckets.set(key, hits);
      return { allowed: true, remaining: limit - hits.length, retryAfterSec: 0 };
    },
    size: () => buckets.size,
  };
  return limiter;
}

/** Convenience: build the per-IP+email key used by login/reset flows. */
export function ipEmailKey(ip: string, email: string): string {
  return `${ip.trim() || "unknown"}:${email.trim().toLowerCase()}`;
}
