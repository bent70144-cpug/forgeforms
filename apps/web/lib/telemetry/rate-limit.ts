// Telemetry rate limiting (§15 builder-event collector). Lives in lib/ so it
// is importable from tests WITHOUT importing the route module — Next.js
// rejects non-HTTP-method exports from app/api route files (a bare
// `export const` in route.ts fails the typed-routes build).

import { createInMemoryRateLimiter, type RateLimiter } from "@formforge/core/identity";

/** Batches per minute, per workspace+user. */
export const TELEMETRY_RATE_LIMIT_PER_MINUTE = 60;

export function createTelemetryRateLimiter(): RateLimiter {
  return createInMemoryRateLimiter({
    limit: TELEMETRY_RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
  });
}

let limiterSingleton: RateLimiter | null = null;

export function getTelemetryRateLimiter(): RateLimiter {
  limiterSingleton ??= createTelemetryRateLimiter();
  return limiterSingleton;
}

/** Test seam: drop the singleton so rate-limit tests start a fresh window. */
export function resetTelemetryRateLimiter(): void {
  limiterSingleton = null;
}
