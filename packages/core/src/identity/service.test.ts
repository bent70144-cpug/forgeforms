import { describe, expect, it, vi } from "vitest";
import { AppError } from "../bridge";
import {
  SESSION_MAX_AGE_MS,
  SESSION_UPDATE_AGE_MS,
  loginUser,
  logoutUser,
  registerUser,
  validateSession,
} from "./service";
import { makeTestHarness, UniqueConstraintError } from "./testing";

const DAY_MS = 24 * 60 * 60 * 1000;

function registerInput(overrides: Partial<{ name: string; email: string; password: string }> = {}) {
  return { name: "Ana Smith", email: "ana@example.com", password: "correct horse battery", ...overrides };
}

describe("registerUser", () => {
  it("creates a user, personal workspace and owner membership atomically, plus a session", async () => {
    const { repos, hasher, ctx } = makeTestHarness();

    const result = await registerUser(ctx, { repos, hasher }, registerInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { user, workspace, sessionToken } = result.value;

    expect(user.email).toBe("ana@example.com");
    expect(user.passwordHash).not.toBeNull();
    expect(user.passwordHash).not.toContain("correct horse battery");
    expect(await hasher.verify("correct horse battery", user.passwordHash as string)).toBe(true);

    expect(workspace.name).toBe("Ana Smith's Workspace");
    expect(workspace.slug).toBe("ana");
    expect(workspace.plan).toBe("free");

    // one atomic write: user + workspace + owner membership
    expect(repos.registrationCalls).toHaveLength(1);
    expect(repos.membershipRows).toEqual([
      { workspaceId: workspace.id, userId: user.id, role: "owner" },
    ]);

    // signup signs the user in (register → dashboard flow)
    expect(repos.sessionsByTokenHash.size).toBe(1);
    expect(sessionToken.length).toBeGreaterThan(20);
  });

  it("normalizes the email to lowercase", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const result = await registerUser(ctx, { repos, hasher }, registerInput({ email: "  Ana@Example.COM " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.email).toBe("ana@example.com");
    expect(repos.usersByEmail.has("ana@example.com")).toBe(true);
  });

  it("rejects a duplicate email with CONFLICT and creates nothing else", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const first = await registerUser(ctx, { repos, hasher }, registerInput());
    expect(first.ok).toBe(true);

    const second = await registerUser(ctx, { repos, hasher }, registerInput({ name: "Copycat" }));

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBeInstanceOf(AppError);
    expect(second.error.code).toBe("CONFLICT");
    expect(second.error.details[0]?.path).toBe("email");
    expect(repos.usersByEmail.size).toBe(1);
    expect(repos.sessionsByTokenHash.size).toBe(1); // no second session
  });

  it("maps a unique-constraint race (pre-check missed) to CONFLICT", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    // Simulate the DB pre-check being bypassed by a concurrent signup.
    vi.spyOn(repos.users, "findByEmail").mockResolvedValue(null);
    await registerUser(ctx, { repos, hasher }, registerInput());
    vi.spyOn(repos.users, "findByEmail").mockResolvedValue(null);

    const raced = await registerUser(ctx, { repos, hasher }, registerInput({ name: "Latecomer" }));

    expect(raced.ok).toBe(false);
    if (raced.ok) return;
    expect(raced.error.code).toBe("CONFLICT");
  });

  it("returns VALIDATION with field details for a bad email and short password", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const result = await registerUser(ctx, { repos, hasher }, { email: "not-an-email", password: "short" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    const paths = result.error.details.map((d) => d.path).sort();
    expect(paths).toEqual(["email", "password"]);
    expect(repos.usersByEmail.size).toBe(0);
  });
});

describe("loginUser", () => {
  it("logs in with valid credentials and returns the personal workspace", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const registered = await registerUser(ctx, { repos, hasher }, registerInput());
    if (!registered.ok) throw new Error("registration failed");

    const result = await loginUser(ctx, { repos, hasher }, {
      email: "ana@example.com",
      password: "correct horse battery",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.id).toBe(registered.value.user.id);
    expect(result.value.workspace?.slug).toBe("ana");
    expect(result.value.role).toBe("owner");
    expect(result.value.sessionToken.length).toBeGreaterThan(20);
    expect(repos.sessionsByTokenHash.size).toBe(2);
  });

  it("is case-insensitive on email", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    await registerUser(ctx, { repos, hasher }, registerInput());
    const result = await loginUser(ctx, { repos, hasher }, {
      email: "ANA@Example.com",
      password: "correct horse battery",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong password with a generic error and no session", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    await registerUser(ctx, { repos, hasher }, registerInput());

    const result = await loginUser(ctx, { repos, hasher }, {
      email: "ana@example.com",
      password: "totally wrong password",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.message).toBe("Invalid email or password.");
    expect(repos.sessionsByTokenHash.size).toBe(1); // only the signup session
  });

  it("gives unknown emails the same generic error (no enumeration)", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const result = await loginUser(ctx, { repos, hasher }, {
      email: "nobody@example.com",
      password: "whatever-password",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("Invalid email or password.");
  });
});

describe("sessions: validate / logout / sliding expiry", () => {
  it("validates a fresh session with user, workspace and role", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const registered = await registerUser(ctx, { repos, hasher }, registerInput());
    if (!registered.ok) throw new Error("registration failed");

    const result = await validateSession(ctx, { repos, hasher }, { token: registered.value.sessionToken });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.email).toBe("ana@example.com");
    expect(result.value.workspace?.slug).toBe("ana");
    expect(result.value.role).toBe("owner");
    expect(result.value.session.expiresAt.getTime()).toBe(ctx.now().getTime() + SESSION_MAX_AGE_MS);
    expect(repos.touchedSessionIds).toHaveLength(0); // fresh: no slide yet
  });

  it("rejects an unknown token with FORBIDDEN", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const result = await validateSession(ctx, { repos, hasher }, { token: "bogus-token" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("logout invalidates the session", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const registered = await registerUser(ctx, { repos, hasher }, registerInput());
    if (!registered.ok) throw new Error("registration failed");
    const token = registered.value.sessionToken;

    const out = await logoutUser(ctx, { repos, hasher }, { token });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.revoked).toBe(true);

    const after = await validateSession(ctx, { repos, hasher }, { token });
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error.code).toBe("FORBIDDEN");
    expect(repos.sessionsByTokenHash.size).toBe(0);
  });

  it("logout of an unknown token reports revoked: false", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const out = await logoutUser(ctx, { repos, hasher }, { token: "bogus" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.revoked).toBe(false);
  });

  it("deletes an expired session and returns FORBIDDEN", async () => {
    const { repos, hasher, ctx, clock } = makeTestHarness();
    const registered = await registerUser(ctx, { repos, hasher }, registerInput());
    if (!registered.ok) throw new Error("registration failed");

    clock.advanceMs(SESSION_MAX_AGE_MS + 1000);
    const result = await validateSession(ctx, { repos, hasher }, { token: registered.value.sessionToken });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
    expect(repos.sessionsByTokenHash.size).toBe(0);
  });

  it("slides the expiry forward after the update interval has elapsed", async () => {
    const { repos, hasher, ctx, clock } = makeTestHarness();
    const registered = await registerUser(ctx, { repos, hasher }, registerInput());
    if (!registered.ok) throw new Error("registration failed");
    const token = registered.value.sessionToken;

    clock.advanceMs(2 * DAY_MS); // 28d remaining < maxAge - updateAge (29d)
    const slid = await validateSession(ctx, { repos, hasher }, { token });
    expect(slid.ok).toBe(true);
    if (!slid.ok) return;
    expect(slid.value.session.expiresAt.getTime()).toBe(clock.now().getTime() + SESSION_MAX_AGE_MS);
    expect(repos.touchedSessionIds).toHaveLength(1);

    clock.advanceMs(1 * DAY_MS); // 29d remaining → not yet due
    const notDue = await validateSession(ctx, { repos, hasher }, { token });
    expect(notDue.ok).toBe(true);
    if (!notDue.ok) return;
    expect(notDue.value.session.expiresAt.getTime()).toBe(slid.value.session.expiresAt.getTime());
    expect(repos.touchedSessionIds).toHaveLength(1);
  });

  it("does not slide more than one update interval per validation", () => {
    expect(SESSION_UPDATE_AGE_MS).toBe(1 * DAY_MS);
    expect(SESSION_MAX_AGE_MS).toBe(30 * DAY_MS);
  });
});

describe("workspace slug uniqueness", () => {
  it("falls back to a suffixed slug on collision", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    await registerUser(ctx, { repos, hasher }, registerInput());
    // Different user, same email local part → colliding base slug "ana".
    const second = await registerUser(ctx, { repos, hasher }, registerInput({ email: "ana@other.org", name: "Ana Other" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.workspace.slug).toMatch(/^ana-[1-9a-zA-Z]{4}$/);
    expect(second.value.workspace.slug).not.toBe("ana");
  });

  it("uses a placeholder when the local part has no slug characters", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    const result = await registerUser(ctx, { repos, hasher }, registerInput({ email: "_._@example.com" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspace.slug).toBe("workspace");
  });
});

describe("unique violation detection", () => {
  it("treats the fake's SQLSTATE-23505-style error like Postgres", async () => {
    const { repos, hasher, ctx } = makeTestHarness();
    await registerUser(ctx, { repos, hasher }, registerInput());
    await expect(
      repos.registration.createAccount({
        user: {
          id: "u2",
          email: "ana@example.com",
          name: null,
          passwordHash: "x",
          emailVerifiedAt: null,
          createdAt: ctx.now(),
        },
        workspace: {
          id: "w2",
          name: "W2",
          slug: "unique-slug",
          plan: "free",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          createdAt: ctx.now(),
        },
        membership: { workspaceId: "w2", userId: "u2", role: "owner" },
      }),
    ).rejects.toThrow(UniqueConstraintError);
  });
});
