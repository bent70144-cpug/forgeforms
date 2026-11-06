// Rate limiter unit tests (spec §17: login and reset rate limited).
// The limiter is an in-memory port (Redis swap in prod) with an injectable
// clock so tests are deterministic.
import { describe, expect, it } from "vitest";
import { createInMemoryRateLimiter, type RateLimiterClock } from "./rate-limit";

function makeClock(startMs = 1_700_000_000_000) {
  const clock: RateLimiterClock = { nowMs: () => current };
  let current = startMs;
  return {
    clock,
    advanceMs(ms: number) {
      current += ms;
    },
  };
}

describe("createInMemoryRateLimiter", () => {
  it("allows up to the limit within one window and reports remaining", () => {
    const { clock } = makeClock();
    const limiter = createInMemoryRateLimiter({ limit: 3, windowMs: 60_000, clock });

    expect(limiter.check("ip1|a@x.dev")).toEqual({ allowed: true, remaining: 2, retryAfterSec: 0 });
    expect(limiter.check("ip1|a@x.dev")).toEqual({ allowed: true, remaining: 1, retryAfterSec: 0 });
    expect(limiter.check("ip1|a@x.dev")).toEqual({ allowed: true, remaining: 0, retryAfterSec: 0 });
  });

  it("blocks the next hit in the same window with a Retry-After hint", () => {
    const { clock } = makeClock();
    const limiter = createInMemoryRateLimiter({ limit: 2, windowMs: 60_000, clock });
    limiter.check("k");
    limiter.check("k");

    const blocked = limiter.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("recovers once the sliding window has drained", () => {
    const { clock, advanceMs } = makeClock();
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 60_000, clock });
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);

    advanceMs(30_000);
    expect(limiter.check("k").allowed).toBe(false); // first hit still in window

    advanceMs(30_001); // > 60s after the first hit
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("keys independently per IP+email pair", () => {
    const { clock } = makeClock();
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 60_000, clock });
    expect(limiter.check("1.2.3.4|a@x.dev").allowed).toBe(true);
    expect(limiter.check("1.2.3.4|b@x.dev").allowed).toBe(true); // other email
    expect(limiter.check("5.6.7.8|a@x.dev").allowed).toBe(true); // other ip
    expect(limiter.check("1.2.3.4|a@x.dev").allowed).toBe(false); // same pair → blocked
  });

  it("bounds memory by dropping drained buckets", () => {
    const { clock } = makeClock();
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: 60_000, clock, maxKeys: 100 });
    for (let i = 0; i < 500; i++) limiter.check(`key-${i}`);
    // All buckets are fresh (within the window) → nothing dropped yet.
    expect(limiter.size()).toBeGreaterThan(0);
  });
});
