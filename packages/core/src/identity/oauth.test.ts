// Google sign-in service tests (ticket #5 acceptance: "Google login
// creates/links user when GOOGLE_CLIENT_ID configured").
import { describe, expect, it } from "vitest";
import { signInWithGoogleProfile } from "./oauth";
import { loginUser, registerUser } from "./service";
import { makeTestHarness } from "./testing";

async function registerAna(harness: ReturnType<typeof makeTestHarness>) {
  const result = await registerUser(harness.ctx, harness, {
    name: "Ana Smith",
    email: "ana@example.com",
    password: "correct horse battery",
  });
  if (!result.ok) throw new Error("registration failed");
  return result.value;
}

describe("signInWithGoogleProfile", () => {
  it("creates a new OAuth-only user with a personal workspace and session", async () => {
    const harness = makeTestHarness();

    const result = await signInWithGoogleProfile(harness.ctx, harness, {
      email: "  Greta@Example.COM ",
      name: "Greta Google",
      emailVerified: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { user, workspace, role, sessionToken } = result.value;

    expect(user.email).toBe("greta@example.com");
    expect(user.name).toBe("Greta Google");
    // Google already proved the email → mirror into users.email_verified_at.
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).toBeNull(); // OAuth-only account

    expect(workspace?.name).toBe("Greta Google's Workspace");
    expect(workspace?.slug).toBe("greta");
    expect(role).toBe("owner");
    expect(harness.repos.registrationCalls).toHaveLength(1);
    expect(sessionToken.length).toBeGreaterThan(20);
    expect(harness.repos.sessionsByTokenHash.size).toBe(1);
  });

  it("links an existing credentials account by email (no duplicate workspace)", async () => {
    const harness = makeTestHarness();
    const account = await registerAna(harness);

    const result = await signInWithGoogleProfile(harness.ctx, harness, {
      email: "ana@example.com",
      name: "Ana Smith",
      emailVerified: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.id).toBe(account.user.id);
    expect(result.value.workspace?.slug).toBe("ana"); // same workspace
    expect(harness.repos.registrationCalls).toHaveLength(1); // no second account
    // Existing session (signup) + new OAuth session.
    expect(harness.repos.sessionsByTokenHash.size).toBe(2);
  });

  it("adopts the Google-verified flag for an unverified local account", async () => {
    const harness = makeTestHarness();
    const account = await registerAna(harness);
    expect(account.user.emailVerifiedAt).toBeNull();

    const result = await signInWithGoogleProfile(harness.ctx, harness, {
      email: "ana@example.com",
      emailVerified: true,
    });

    expect(result.ok).toBe(true);
    const user = harness.repos.usersByEmail.get("ana@example.com");
    expect(user?.emailVerifiedAt).not.toBeNull();
    if (!result.ok) return;
    expect(result.value.user.emailVerifiedAt).not.toBeNull();
  });

  it("rejects a profile without an email", async () => {
    const harness = makeTestHarness();
    const result = await signInWithGoogleProfile(harness.ctx, harness, {
      email: "   ",
      emailVerified: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(harness.repos.registrationCalls).toHaveLength(0);
  });

  it("OAuth-only users can still log in via Google again (session each time)", async () => {
    const harness = makeTestHarness();
    await signInWithGoogleProfile(harness.ctx, harness, { email: "greta@example.com", emailVerified: true });
    const second = await signInWithGoogleProfile(harness.ctx, harness, { email: "greta@example.com", emailVerified: true });
    expect(second.ok).toBe(true);
    expect(harness.repos.registrationCalls).toHaveLength(1);
    expect(harness.repos.sessionsByTokenHash.size).toBe(2);

    // Credentials login is still impossible without a password.
    const creds = await loginUser(harness.ctx, harness, { email: "greta@example.com", password: "whatever" });
    expect(creds.ok).toBe(false);
  });
});
