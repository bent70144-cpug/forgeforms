// Auth flow rate limiting (ticket #5 acceptance: "Reset/login endpoints rate
// limited per IP+email"). Uses fresh limiter instances — no cross-test state.
import { describe, expect, it } from "vitest";
import { checkLoginRateLimit } from "@/lib/auth/recovery-flow";
import { createAuthRateLimiters, rateLimitKeyFor } from "@/lib/auth/rate-limit";
import { LOGIN_RATE_LIMIT_PER_MINUTE } from "@/lib/auth/rate-limit";

describe("auth rate limiting (per IP+email)", () => {
  it("allows LOGIN_RATE_LIMIT_PER_MINUTE attempts per IP+email, then blocks", () => {
    expect(LOGIN_RATE_LIMIT_PER_MINUTE).toBe(10);
    const limiters = createAuthRateLimiters();
    const ip = "203.0.113.7";
    const email = "brute@example.com";

    for (let i = 0; i < LOGIN_RATE_LIMIT_PER_MINUTE; i++) {
      const decision = checkLoginRateLimit({ ip, email, limiter: limiters.login });
      expect(decision).toBeNull();
    }

    const blocked = checkLoginRateLimit({ ip, email, limiter: limiters.login });
    expect(blocked).not.toBeNull();
    expect(blocked!.error.code).toBe("RATE_LIMITED");
    expect(blocked!.error.message).toContain("Too many attempts");
  });

  it("keys per IP+email — a different IP or email is not affected", () => {
    const limiters = createAuthRateLimiters();
    const ip = "203.0.113.7";
    const email = "brute@example.com";

    for (let i = 0; i < LOGIN_RATE_LIMIT_PER_MINUTE; i++) {
      checkLoginRateLimit({ ip, email, limiter: limiters.login });
    }
    expect(checkLoginRateLimit({ ip, email, limiter: limiters.login })).not.toBeNull();

    // Different email, same IP → fresh bucket.
    expect(checkLoginRateLimit({ ip, email: "other@example.com", limiter: limiters.login })).toBeNull();
    // Same email, different IP → fresh bucket.
    expect(checkLoginRateLimit({ ip: "198.51.100.9", email, limiter: limiters.login })).toBeNull();
  });

  it("normalizes the email in the key (case/whitespace variants share a bucket)", () => {
    expect(rateLimitKeyFor("1.2.3.4", "  A@Example.COM ")).toBe("1.2.3.4:a@example.com");
    const limiters = createAuthRateLimiters();
    checkLoginRateLimit({ ip: "1.2.3.4", email: "A@Example.COM", limiter: limiters.login });
    // Same logical identity → second call still allowed (limit 10), keys equal.
    expect(rateLimitKeyFor("1.2.3.4", "a@example.com")).toBe(rateLimitKeyFor("1.2.3.4", "A@Example.COM"));
  });

  it("forgot-password and reset-password have their own tighter/parallel limits", () => {
    const limiters = createAuthRateLimiters();
    // Forgot: 5/min per IP+email.
    for (let i = 0; i < 5; i++) limiters.forgotPassword.check(rateLimitKeyFor("9.9.9.9", "a@example.com"));
    const forgotBlocked = limiters.forgotPassword.check(rateLimitKeyFor("9.9.9.9", "a@example.com"));
    expect(forgotBlocked.allowed).toBe(false);
    expect(forgotBlocked.retryAfterSec).toBeGreaterThan(0);

    // Reset: independent limiter; still allows after forgot is exhausted.
    expect(limiters.resetPassword.check(rateLimitKeyFor("9.9.9.9", "reset")).allowed).toBe(true);
    expect(limiters.resetPassword.check("token:abc").allowed).toBe(true);
  });
});
