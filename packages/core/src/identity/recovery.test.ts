// Password reset + email verification service tests (ticket #5 acceptance):
// - request reset → receive token (dev transport fake) → set new password →
//   log in with it;
// - reset token single-use and expired after 1h;
// - verification flow updates the verified-at column.
// All DB-free: in-memory repository fakes + capturing mailer.
import { describe, expect, it } from "vitest";
import { AppError } from "../bridge";
import {
  RESET_TOKEN_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
  hashToken,
} from "./tokens";
import {
  requestPasswordReset,
  resetPassword,
  sendEmailVerification,
  verifyEmail,
} from "./recovery";
import { loginUser, registerUser } from "./service";
import { makeFakeMailer, makeTestHarness } from "./testing";

const HOUR_MS = 60 * 60 * 1000;

/** Pull the raw reset token out of the (fake) delivered email. */
function resetTokenFromEmail(text: string): string {
  const match = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error(`no reset link in email: ${text}`);
  return match[1]!;
}

function verifyTokenFromEmail(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error(`no verify link in email: ${text}`);
  return match[1]!;
}

async function registerAna(harness: ReturnType<typeof makeTestHarness>) {
  const result = await registerUser(harness.ctx, harness, {
    name: "Ana Smith",
    email: "ana@example.com",
    password: "correct horse battery",
  });
  if (!result.ok) throw new Error("registration failed");
  return result.value;
}

describe("requestPasswordReset", () => {
  it("emails a hashed, single-use token link that expires in exactly 1h", async () => {
    const harness = makeTestHarness();
    await registerAna(harness);
    const mailer = makeFakeMailer();

    const result = await requestPasswordReset(harness.ctx, { ...harness, mailer }, { email: "ana@example.com" });

    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("ana@example.com");
    expect(mailer.sent[0]!.subject).toContain("Reset");

    const rawToken = resetTokenFromEmail(mailer.sent[0]!.text ?? "");
    // Hashed at rest — the raw token must not appear anywhere in storage.
    const stored = harness.repos.authTokensByHash.get(hashToken(rawToken));
    expect(stored).toBeDefined();
    expect(stored!.kind).toBe("password_reset");
    expect(stored!.consumedAt).toBeNull();
    // Ticket acceptance: expired after 1h.
    expect(stored!.expiresAt.getTime() - harness.ctx.now().getTime()).toBe(RESET_TOKEN_TTL_MS);
    expect(RESET_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("stays silent for unknown emails (no enumeration, no token stored)", async () => {
    const harness = makeTestHarness();
    const mailer = makeFakeMailer();

    const result = await requestPasswordReset(harness.ctx, { ...harness, mailer }, { email: "ghost@example.com" });

    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(0);
    expect(harness.repos.authTokensByHash.size).toBe(0);
  });

  it("invalidates the previous outstanding reset token on re-request", async () => {
    const harness = makeTestHarness();
    await registerAna(harness);
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await requestPasswordReset(harness.ctx, deps, { email: "ana@example.com" });
    await requestPasswordReset(harness.ctx, deps, { email: "ana@example.com" });

    expect(harness.repos.authTokensByHash.size).toBe(1); // old token gone
    expect(mailer.sent).toHaveLength(2);
  });

  it("validates the email field", async () => {
    const harness = makeTestHarness();
    const result = await requestPasswordReset(harness.ctx, harness, { email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.details[0]?.path).toBe("email");
  });
});

describe("resetPassword (acceptance: set new password → log in with it)", () => {
  it("completes the full acceptance loop: reset → new password → login", async () => {
    const harness = makeTestHarness();
    const account = await registerAna(harness);
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await requestPasswordReset(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = resetTokenFromEmail(mailer.sent[0]!.text ?? "");

    const reset = await resetPassword(harness.ctx, deps, {
      token: rawToken,
      password: "brand-new-password-9",
    });
    expect(reset.ok).toBe(true);

    // Old password no longer works…
    const oldLogin = await loginUser(harness.ctx, harness, {
      email: "ana@example.com",
      password: "correct horse battery",
    });
    expect(oldLogin.ok).toBe(false);

    // …new password does (acceptance).
    const newLogin = await loginUser(harness.ctx, harness, {
      email: "ana@example.com",
      password: "brand-new-password-9",
    });
    expect(newLogin.ok).toBe(true);
    if (!newLogin.ok) return;
    expect(newLogin.value.user.id).toBe(account.user.id);
  });

  it("consumes the token on use and rejects the second use (single-use)", async () => {
    const harness = makeTestHarness();
    await registerAna(harness);
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await requestPasswordReset(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = resetTokenFromEmail(mailer.sent[0]!.text ?? "");

    const first = await resetPassword(harness.ctx, deps, { token: rawToken, password: "first-new-pass-1" });
    expect(first.ok).toBe(true);

    const second = await resetPassword(harness.ctx, deps, { token: rawToken, password: "second-new-pass" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("VALIDATION");
    expect(second.error.message).toContain("invalid or has expired");
  });

  it("rejects a token older than 1h", async () => {
    const harness = makeTestHarness();
    await registerAna(harness);
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await requestPasswordReset(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = resetTokenFromEmail(mailer.sent[0]!.text ?? "");
    harness.clock.advanceMs(RESET_TOKEN_TTL_MS + 1); // 1h + 1ms

    const result = await resetPassword(harness.ctx, deps, { token: rawToken, password: "too-late-pass-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    // A just-expired token must not have been consumed or changed the password.
    const login = await loginUser(harness.ctx, harness, { email: "ana@example.com", password: "too-late-pass-1" });
    expect(login.ok).toBe(false);
  });

  it("signs the user out everywhere after a successful reset", async () => {
    const harness = makeTestHarness();
    const account = await registerAna(harness); // signup created a session
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await requestPasswordReset(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = resetTokenFromEmail(mailer.sent[0]!.text ?? "");

    const reset = await resetPassword(harness.ctx, deps, { token: rawToken, password: "fresh-pass-12345" });
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.value.revokedSessions).toBe(1);
    expect(harness.repos.sessionsByTokenHash.size).toBe(0); // signup session revoked
    expect(account.sessionToken).toBeDefined();
  });

  it("rejects short passwords with field details and leaves the token usable", async () => {
    const harness = makeTestHarness();
    await registerAna(harness);
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await requestPasswordReset(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = resetTokenFromEmail(mailer.sent[0]!.text ?? "");

    const weak = await resetPassword(harness.ctx, deps, { token: rawToken, password: "short" });
    expect(weak.ok).toBe(false);
    if (weak.ok) return;
    expect(weak.error.details[0]?.path).toBe("password");

    // Validation failure must not burn the token.
    const retry = await resetPassword(harness.ctx, deps, { token: rawToken, password: "long-enough-pass" });
    expect(retry.ok).toBe(true);
  });

  it("rejects unknown tokens with the same generic error", async () => {
    const harness = makeTestHarness();
    const result = await resetPassword(harness.ctx, harness, { token: "bogus-token", password: "whatever-pass-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("This link is invalid or has expired.");
  });

  it("does not accept a verification token for password reset (kind-mismatch)", async () => {
    const harness = makeTestHarness();
    await registerAna(harness);
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await sendEmailVerification(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = verifyTokenFromEmail(mailer.sent[0]!.text ?? "");

    const result = await resetPassword(harness.ctx, deps, { token: rawToken, password: "wrong-kind-pass" });
    expect(result.ok).toBe(false);
  });
});

describe("email verification (verified-at column update)", () => {
  it("sets email_verified_at when the token is consumed", async () => {
    const harness = makeTestHarness();
    const account = await registerAna(harness);
    expect(account.user.emailVerifiedAt).toBeNull();
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };

    await sendEmailVerification(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = verifyTokenFromEmail(mailer.sent[0]!.text ?? "");

    const verified = await verifyEmail(harness.ctx, deps, { token: rawToken });
    expect(verified.ok).toBe(true);

    const user = harness.repos.usersByEmail.get("ana@example.com");
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.emailVerifiedAt?.getTime()).toBe(harness.ctx.now().getTime());
  });

  it("is single-use and expires after 24h", async () => {
    const harness = makeTestHarness();
    await registerAna(harness);
    const mailer = makeFakeMailer();
    const deps = { ...harness, mailer };
    expect(VERIFY_TOKEN_TTL_MS).toBe(24 * HOUR_MS);

    await sendEmailVerification(harness.ctx, deps, { email: "ana@example.com" });
    const rawToken = verifyTokenFromEmail(mailer.sent[0]!.text ?? "");

    const first = await verifyEmail(harness.ctx, deps, { token: rawToken });
    expect(first.ok).toBe(true);
    const second = await verifyEmail(harness.ctx, deps, { token: rawToken });
    expect(second.ok).toBe(false);

    await sendEmailVerification(harness.ctx, deps, { email: "ana@example.com" });
    // Already-verified users get no new token/email (quiet no-op).
    expect(mailer.sent).toHaveLength(1);

    // Expiry: issue for a fresh unverified user, then advance past 24h.
    const other = await registerUser(harness.ctx, harness, {
      name: "Bob Later",
      email: "bob@example.com",
      password: "bob-password-123",
    });
    if (!other.ok) throw new Error("registration failed");
    await sendEmailVerification(harness.ctx, deps, { email: "bob@example.com" });
    const bobToken = verifyTokenFromEmail(mailer.sent[1]!.text ?? "");
    harness.clock.advanceMs(VERIFY_TOKEN_TTL_MS + 1);
    const expired = await verifyEmail(harness.ctx, deps, { token: bobToken });
    expect(expired.ok).toBe(false);
    if (expired.ok) return;
    expect(expired.error.code).toBe("VALIDATION");
  });

  it("keeps the same neutral result for unknown emails", async () => {
    const harness = makeTestHarness();
    const mailer = makeFakeMailer();
    const result = await sendEmailVerification(harness.ctx, { ...harness, mailer }, { email: "ghost@example.com" });
    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(0);
  });

  it("fails cleanly when no mailer is configured", async () => {
    const harness = makeTestHarness();
    const result = await requestPasswordReset(harness.ctx, harness, { email: "ana@example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AppError);
    expect(result.error.code).toBe("INTERNAL");
  });
});
