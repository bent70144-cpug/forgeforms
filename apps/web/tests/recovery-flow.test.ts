// Recovery flow end-to-end (unit level, DB-free): the exact ticket acceptance
// chain "request reset → receive token (dev transport) → set new password →
// log in with it", plus verification flow and rate-limit interplay.
// Uses the core in-memory identity fakes + dev mailer with a temp outbox.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loginUser, registerUser, type IdentityDeps } from "@formforge/core/identity";
import { makeTestHarness } from "@formforge/core/identity/testing";
import { createDevMailer } from "@/lib/auth/dev-mail";
import {
  checkLoginRateLimit,
  runForgotPassword,
  runResetPassword,
  runSendEmailVerification,
  runVerifyEmailToken,
} from "@/lib/auth/recovery-flow";
import { createAuthRateLimiters } from "@/lib/auth/rate-limit";

const RESET_LINK_RE = /\/reset-password\?token=([A-Za-z0-9_-]+)/;
const VERIFY_LINK_RE = /\/api\/auth\/verify-email\?token=([A-Za-z0-9_-]+)/;

const ORIGIN = "https://app.test";

const tempDirs: string[] = [];
function freshOutbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "ff-recovery-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Identity deps wired to the SAME in-memory repos as the harness + dev mailer. */
function makeDeps(
  outboxDir: string,
  harness: ReturnType<typeof makeTestHarness>,
): IdentityDeps {
  return { ...harness, mailer: createDevMailer({ outboxDir }), appOrigin: ORIGIN };
}

function outboxLines(outboxDir: string): string[] {
  return readFileSync(join(outboxDir, "dev-emails.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
}

describe("runForgotPassword → runResetPassword → login (acceptance chain)", () => {
  it("delivers a working single-use reset link through the dev transport", async () => {
    const outbox = freshOutbox();
    const harness = makeTestHarness();
    const deps = makeDeps(outbox, harness);
    const limiters = createAuthRateLimiters();

    const registered = await registerUser(harness.ctx, harness, {
      name: "Ana Smith",
      email: "ana@example.com",
      password: "correct horse battery",
    });
    if (!registered.ok) throw new Error("registration failed");

    // 1. request reset
    const forgot = await runForgotPassword({
      deps,
      email: "ana@example.com",
      ip: "203.0.113.5",
      limiter: limiters.forgotPassword,
      origin: ORIGIN,
    });
    expect(forgot.ok).toBe(true);

    // 2. receive token via the dev transport (E2E reads this same outbox)
    const lines = outboxLines(outbox);
    expect(lines).toHaveLength(1);
    const message = JSON.parse(lines[0]!) as { to: string; text: string; html: string };
    expect(message.to).toBe("ana@example.com");
    expect(message.text).toContain("60 minutes"); // 1h expiry copy
    const token = RESET_LINK_RE.exec(message.text)?.[1];
    expect(token).toBeDefined();
    expect(token!.length).toBeGreaterThan(20); // 32 bytes base64url

    // 3. set the new password with the token from the link
    const reset = await runResetPassword({
      deps,
      token: token!,
      password: "brand-new-password-9",
      ip: "203.0.113.5",
      tokenHash: `hash-${token}`,
      limiter: limiters.resetPassword,
    });
    expect(reset.ok).toBe(true);

    // 4. log in with the new password (acceptance)
    const login = await loginUser(harness.ctx, harness, {
      email: "ana@example.com",
      password: "brand-new-password-9",
    });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(login.value.user.id).toBe(registered.value.user.id);
  });

  it("a second reset request invalidates the first link", async () => {
    const outbox = freshOutbox();
    const harness = makeTestHarness();
    const deps = makeDeps(outbox, harness);
    const limiters = createAuthRateLimiters();

    await registerUser(harness.ctx, harness, {
      name: "Ana Smith",
      email: "ana@example.com",
      password: "correct horse battery",
    });

    const forgotInput = { deps, ip: "1.1.1.1", limiter: limiters.forgotPassword, origin: ORIGIN, email: "ana@example.com" };
    await runForgotPassword(forgotInput);
    await runForgotPassword(forgotInput);

    const lines = outboxLines(outbox);
    expect(lines).toHaveLength(2);
    const firstToken = RESET_LINK_RE.exec(JSON.parse(lines[0]!).text)?.[1]!;
    const secondToken = RESET_LINK_RE.exec(JSON.parse(lines[1]!).text)?.[1]!;
    expect(firstToken).not.toBe(secondToken);

    const stale = await runResetPassword({
      deps, token: firstToken, password: "long-enough-pass", ip: "1.1.1.1",
      tokenHash: `hash-${firstToken}`, limiter: limiters.resetPassword,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return; // narrow; unreachable when the flow is correct
    expect(stale.error.message).toContain("invalid or has expired");

    const fresh = await runResetPassword({
      deps, token: secondToken, password: "long-enough-pass", ip: "1.1.1.1",
      tokenHash: `hash-${secondToken}`, limiter: limiters.resetPassword,
    });
    expect(fresh.ok).toBe(true);
  });

  it("rate limiting blocks the 11th login attempt per IP+email", async () => {
    const limiters = createAuthRateLimiters();
    for (let i = 0; i < 10; i++) {
      expect(checkLoginRateLimit({ ip: "5.5.5.5", email: "a@example.com", limiter: limiters.login })).toBeNull();
    }
    const blocked = checkLoginRateLimit({ ip: "5.5.5.5", email: "a@example.com", limiter: limiters.login });
    expect(blocked?.error.code).toBe("RATE_LIMITED");
  });

  it("verify-email flow consumes the token and the second click fails", async () => {
    const outbox = freshOutbox();
    const harness = makeTestHarness();
    const deps = makeDeps(outbox, harness);
    const limiters = createAuthRateLimiters();

    const registered = await registerUser(harness.ctx, harness, {
      name: "Bob",
      email: "bob@example.com",
      password: "bob-password-123",
    });
    if (!registered.ok) throw new Error("registration failed");
    expect(registered.value.user.emailVerifiedAt).toBeNull();

    await runSendEmailVerification({ deps, email: "bob@example.com", origin: ORIGIN });

    const lines = outboxLines(outbox);
    expect(lines).toHaveLength(1);
    const message = JSON.parse(lines[0]!) as { to: string; text: string };
    expect(message.to).toBe("bob@example.com");
    const token = VERIFY_LINK_RE.exec(message.text)?.[1]!;
    expect(token).toBeDefined();

    const first = await runVerifyEmailToken({ deps, token, ip: "2.2.2.2", limiter: limiters.login });
    expect(first.ok).toBe(true);
    const user = harness.repos.usersByEmail.get("bob@example.com");
    expect(user?.emailVerifiedAt).not.toBeNull();

    const second = await runVerifyEmailToken({ deps, token, ip: "2.2.2.2", limiter: limiters.login });
    expect(second.ok).toBe(false);
    if (second.ok) return; // narrow; unreachable when the flow is correct
    expect(second.error.message).toContain("invalid or has expired");
  });
});
