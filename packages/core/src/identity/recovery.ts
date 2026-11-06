// Password reset + email verification services (ticket #5, spec §12/§17).
//
// Flow contracts:
//   requestPasswordReset — no enumeration (same result for unknown emails),
//     token stored hashed, 1h expiry, previous outstanding reset tokens
//     invalidated, email via the injected Mailer port (Resend in prod, console
//     dev transport when RESEND_API_KEY is unset).
//   resetPassword — token must be valid kind, unexpired, single-use (atomic
//     consume), sets the new argon2id/scrypt hash, revokes all sessions
//     (sign out everywhere).
//   verifyEmail — token single-use + 24h expiry, updates the user's
//     verified-at column (spec §6 users.email_verified_at).
import { v7 as uuidv7 } from "uuid";
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";;
import { defaultAuthEmailRenderer } from "./emails";
import type { IdentityDeps } from "./ports";
import { ResetPasswordInputSchema, RequestPasswordResetInputSchema, zodToDetails } from "./schemas";
import {
  RESET_EXPIRY_MINUTES,
  RESET_TOKEN_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
  hashToken,
  generateAuthToken,
} from "./tokens";
import type { AuthTokenKind } from "./tokens";

export type RequestPasswordResetOutput = {
  /** Always true on success — unknown emails still report sent (no enumeration). */
  sent: boolean;
  /** Neutral copy for the UI; identical for known and unknown emails. */
  message: string;
};

export type ResetPasswordOutput = {
  userId: string;
  revokedSessions: number;
};

export type VerifyEmailOutput = {
  userId: string;
  emailVerifiedAt: Date;
};

const GENERIC_RESET_SENT = "If that email exists, a reset link is on its way.";

// SPEC-NOTE: pre-auth flows use the system-actor ctx (see preAuthCtx in
// ./service) — nothing here scopes tenant reads.

export async function requestPasswordReset(
  ctx: Ctx,
  deps: IdentityDeps,
  input: unknown,
): Promise<Result<RequestPasswordResetOutput>> {
  const parsed = RequestPasswordResetInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(new AppError("VALIDATION", "Please fix the errors below.", zodToDetails(parsed.error)));
  }
  const email = parsed.data.email;
  const mailer = requireMailer(deps);
  if (!mailer.ok) return mailer;

  const user = await deps.repos.users.findByEmail(email);
  if (user) {
    // One outstanding reset token per user: invalidate the previous one.
    await deps.repos.authTokens.deleteUnconsumedByUser(user.id, "password_reset", ctx.now());
    const rawToken = await issueToken(ctx, deps, user.id, "password_reset", RESET_TOKEN_TTL_MS);
    const origin = deps.appOrigin ?? "http://localhost:3000";
    const url = `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const renderer = deps.emails ?? defaultAuthEmailRenderer;
    const rendered = renderer.passwordReset({ url, expiresInMinutes: RESET_EXPIRY_MINUTES });
    await mailer.value.send({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  return ok({ sent: true, message: GENERIC_RESET_SENT });
}

export async function resetPassword(
  ctx: Ctx,
  deps: IdentityDeps,
  input: unknown,
): Promise<Result<ResetPasswordOutput>> {
  const parsed = ResetPasswordInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(new AppError("VALIDATION", "Please fix the errors below.", zodToDetails(parsed.error)));
  }
  const { token, password } = parsed.data;

  const consumed = await consumeValidToken(ctx, deps, token, "password_reset");
  if (!consumed.ok) return consumed;

  const passwordHash = await deps.hasher.hash(password);
  await deps.repos.users.setPasswordHash(consumed.value.userId, passwordHash);
  // Sign out everywhere: any session held with the old password must die.
  const revokedSessions = await deps.repos.sessions.deleteForUser(consumed.value.userId);
  return ok({ userId: consumed.value.userId, revokedSessions });
}

export async function verifyEmail(
  ctx: Ctx,
  deps: IdentityDeps,
  input: { token: string },
): Promise<Result<VerifyEmailOutput>> {
  const token = typeof input?.token === "string" ? input.token.trim() : "";
  if (token.length === 0) {
    return err(new AppError("VALIDATION", "Verification token missing.", [{ path: "token", message: "Token is required" }]));
  }
  const consumed = await consumeValidToken(ctx, deps, token, "email_verify");
  if (!consumed.ok) return consumed;

  const verifiedAt = ctx.now();
  await deps.repos.users.markEmailVerified(consumed.value.userId, verifiedAt);
  return ok({ userId: consumed.value.userId, emailVerifiedAt: verifiedAt });
}

/** Send (or re-send) the verification email for an existing account. */
export async function sendEmailVerification(
  ctx: Ctx,
  deps: IdentityDeps,
  input: { email: string },
): Promise<Result<{ sent: boolean }>> {
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email.length === 0) {
    return err(new AppError("VALIDATION", "Email required.", [{ path: "email", message: "Email is required" }]));
  }
  const mailer = requireMailer(deps);
  if (!mailer.ok) return mailer;

  const user = await deps.repos.users.findByEmail(email);
  if (user && user.emailVerifiedAt === null) {
    await deps.repos.authTokens.deleteUnconsumedByUser(user.id, "email_verify", ctx.now());
    const rawToken = await issueToken(ctx, deps, user.id, "email_verify", VERIFY_TOKEN_TTL_MS);
    const origin = deps.appOrigin ?? "http://localhost:3000";
    const url = `${origin}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
    const renderer = deps.emails ?? defaultAuthEmailRenderer;
    const rendered = renderer.emailVerification({ url });
    await mailer.value.send({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
  // Unknown or already-verified emails: same quiet success (no enumeration).
  return ok({ sent: true });
}

// --- internals --------------------------------------------------------------

type ConsumedToken = { ok: true; value: { userId: string } };
type TokenFailure = { ok: false; error: AppError };

async function consumeValidToken(
  ctx: Ctx,
  deps: IdentityDeps,
  rawToken: string,
  kind: AuthTokenKind,
): Promise<ConsumedToken | TokenFailure> {
  const tokenHash = hashToken(rawToken);
  const record = await deps.repos.authTokens.findByTokenHash(tokenHash);
  // Same error for unknown / wrong-kind / consumed / expired — no oracle.
  const invalid = () => new AppError("VALIDATION", "This link is invalid or has expired.", [
    { path: "token", message: "This link is invalid or has expired" },
  ]);
  if (!record || record.kind !== kind) return { ok: false, error: invalid() };

  const now = ctx.now();
  if (record.expiresAt.getTime() <= now.getTime()) return { ok: false, error: invalid() };

  // Atomic single-use: only the first caller flips consumed_at.
  const firstUse = await deps.repos.authTokens.consumeByTokenHash(tokenHash, now);
  if (!firstUse) return { ok: false, error: invalid() };
  return { ok: true, value: { userId: record.userId } };
}

async function issueToken(
  ctx: Ctx,
  deps: IdentityDeps,
  userId: string,
  kind: AuthTokenKind,
  ttlMs: number,
): Promise<string> {
  const rawToken = generateAuthToken();
  await deps.repos.authTokens.create({
    id: uuidv7(),
    userId,
    kind,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(ctx.now().getTime() + ttlMs),
    consumedAt: null,
    createdAt: ctx.now(),
  });
  return rawToken;
}

function requireMailer(deps: IdentityDeps): { ok: true; value: NonNullable<IdentityDeps["mailer"]> } | { ok: false; error: AppError } {
  if (!deps.mailer) {
    return {
      ok: false,
      error: new AppError("INTERNAL", "Mail transport is not configured."),
    };
  }
  return { ok: true, value: deps.mailer };
}
