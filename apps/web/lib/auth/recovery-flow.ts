// Recovery-flow orchestration (ticket #5): the server actions and route
// handlers below are thin Next.js wrappers around these functions so the
// flows are unit-testable with in-memory deps (no next/headers, no DB).
//
// Rate limiting (spec §17 + ticket acceptance): login + forgot-password are
// limited per IP+email; the reset-password POST is limited per IP and per
// token-hash (the email only becomes known after the token resolves — the
// issuing endpoint is the IP+email-limited one).
import {
  errorBody,
  preAuthCtx,
  requestPasswordReset,
  resetPassword,
  sendEmailVerification,
  verifyEmail,
  type AppError,
  type IdentityDeps,
  type RateLimiter,
} from "@formforge/core/identity";
import type { AuthErrorBody } from "./actions";
import { rateLimitKeyFor } from "./rate-limit";

export type FlowSuccess = { ok: true; message?: string };
export type FlowFailure = { ok: false; error: AuthErrorBody };
export type FlowResult = FlowSuccess | FlowFailure;

function rateLimited(retryAfterSec: number): FlowFailure {
  return {
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message:
        retryAfterSec >= 60
          ? "Too many attempts. Please wait a minute and try again."
          : `Too many attempts. Please try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`,
      details: [],
    },
  };
}

function toFailure(result: { ok: false; error: AppError }): FlowFailure {
  return { ok: false, error: errorBody(result.error).error };
}

function checkLimiter(limiter: RateLimiter, key: string): FlowFailure | null {
  const decision = limiter.check(key);
  return decision.allowed ? null : rateLimited(decision.retryAfterSec);
}

// --- forgot password ---------------------------------------------------------

export type ForgotPasswordInput = {
  deps: IdentityDeps;
  email: string;
  ip: string;
  limiter: RateLimiter;
  origin: string;
};

/** Request a reset link. Neutral success for unknown emails (no enumeration). */
export async function runForgotPassword(input: ForgotPasswordInput): Promise<FlowResult> {
  const blocked = checkLimiter(input.limiter, rateLimitKeyFor(input.ip, input.email));
  if (blocked) return blocked;

  const result = await requestPasswordReset(preAuthCtx(), input.deps, { email: input.email });
  if (!result.ok) return toFailure(result);
  return { ok: true, message: result.value.message };
}

// --- reset password ----------------------------------------------------------

export type ResetPasswordInput = {
  deps: IdentityDeps;
  token: string;
  password: string;
  ip: string;
  tokenHash: string;
  limiter: RateLimiter;
};

export async function runResetPassword(input: ResetPasswordInput): Promise<FlowResult> {
  // Per IP and per token-hash (see module note).
  const blocked =
    checkLimiter(input.limiter, rateLimitKeyFor(input.ip, "reset")) ??
    checkLimiter(input.limiter, `token:${input.tokenHash}`);
  if (blocked) return blocked;

  const result = await resetPassword(preAuthCtx(), input.deps, { token: input.token, password: input.password });
  if (!result.ok) return toFailure(result);
  return { ok: true };
}

// --- email verification ------------------------------------------------------

export type SendVerificationInput = {
  deps: IdentityDeps;
  email: string;
  origin: string;
};

/** Fire-and-forget verification email after signup (best-effort). */
export async function runSendEmailVerification(input: SendVerificationInput): Promise<void> {
  await sendEmailVerification(preAuthCtx(), input.deps, { email: input.email });
}

export type VerifyEmailInput = {
  deps: IdentityDeps;
  token: string;
  ip: string;
  limiter: RateLimiter;
};

export async function runVerifyEmailToken(input: VerifyEmailInput): Promise<FlowResult> {
  const blocked = checkLimiter(input.limiter, rateLimitKeyFor(input.ip, "verify"));
  if (blocked) return blocked;

  const result = await verifyEmail(preAuthCtx(), input.deps, { token: input.token });
  if (!result.ok) return toFailure(result);
  return { ok: true, message: "Email verified." };
}

// --- login rate limit ---------------------------------------------------------

export type LoginRateLimitInput = { ip: string; email: string; limiter: RateLimiter };

export function checkLoginRateLimit(input: LoginRateLimitInput): FlowFailure | null {
  return checkLimiter(input.limiter, rateLimitKeyFor(input.ip, input.email));
}
