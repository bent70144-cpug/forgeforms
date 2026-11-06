// Auth flow rate limits (ticket #5 acceptance: "Reset/login endpoints rate
// limited per IP+email"; spec §17: "login and reset rate limited").
//
// Backed by the in-memory limiter port in @formforge/core/identity (Redis swap
// in prod — INTEGRATION-DEBT, same as the /api/v1 limiter). One process-local
// singleton for the live app; tests build fresh instances via
// createAuthRateLimiters().
import {
  createInMemoryRateLimiter,
  ipEmailKey,
  type RateLimiter,
} from "@formforge/core/identity";

export const LOGIN_RATE_LIMIT_PER_MINUTE = 10;
export const FORGOT_PASSWORD_RATE_LIMIT_PER_MINUTE = 5;
/**
 * Reset attempts (POST with a token) — the email is not known until the token
 * resolves, so this is per IP plus per token-hash; the issuing endpoint
 * (forgot-password) is the one limited per IP+email.
 */
export const RESET_PASSWORD_RATE_LIMIT_PER_MINUTE = 10;

export type AuthRateLimiters = {
  login: RateLimiter;
  forgotPassword: RateLimiter;
  resetPassword: RateLimiter;
};

export function createAuthRateLimiters(): AuthRateLimiters {
  return {
    login: createInMemoryRateLimiter({ limit: LOGIN_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 }),
    forgotPassword: createInMemoryRateLimiter({ limit: FORGOT_PASSWORD_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 }),
    resetPassword: createInMemoryRateLimiter({ limit: RESET_PASSWORD_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 }),
  };
}

// Process-local singleton for live request handling.
let singleton: AuthRateLimiters | undefined;
export function getAuthRateLimiters(): AuthRateLimiters {
  if (!singleton) singleton = createAuthRateLimiters();
  return singleton;
}

/** Per-IP+email key ("1.2.3.4:user@example.com"). */
export function rateLimitKeyFor(ip: string, email: string): string {
  return ipEmailKey(ip, email);
}
