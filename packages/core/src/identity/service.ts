// Identity services (spec §3 module contract): Ctx-first, Result-returning.
// register/login/logout/session — signup auto-creates a personal workspace
// with an owner membership (spec §21.5, milestone M1).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { AppError, err, ok, type Ctx, type Result } from "../bridge";
import type { IdentityDeps } from "./ports";
import { LoginInputSchema, RegisterInputSchema, zodToDetails } from "./schemas";
import type { MembershipRole, SessionRecord, UserRecord, WorkspaceRecord } from "./types";

// Session lifetimes live in ./policy (dependency-free, edge-safe).
export { SESSION_MAX_AGE_MS, SESSION_UPDATE_AGE_MS } from "./policy";
import { SESSION_MAX_AGE_MS, SESSION_UPDATE_AGE_MS } from "./policy";

export type RegisterOutput = {
  user: UserRecord;
  workspace: WorkspaceRecord;
  /** Opaque session token — return value only; only its sha256 is persisted. */
  sessionToken: string;
};

export type LoginOutput = {
  user: UserRecord;
  workspace: WorkspaceRecord | null;
  role: MembershipRole | null;
  sessionToken: string;
};

export type AuthenticatedSession = {
  session: SessionRecord;
  user: UserRecord;
  workspace: WorkspaceRecord | null;
  role: MembershipRole | null;
};

// SPEC-NOTE: register/login run before any workspace exists. Spec §3 requires a
// Ctx on every service; pre-auth flows use a system actor with a "system"
// workspace sentinel (it never scopes tenant reads).
export function preAuthCtx(requestId: string = randomUUID()): Ctx {
  return {
    workspaceId: "system",
    actor: { type: "system", id: "auth" },
    requestId,
    now: () => new Date(),
  };
}

export async function registerUser(
  ctx: Ctx,
  deps: IdentityDeps,
  input: unknown,
): Promise<Result<RegisterOutput>> {
  const parsed = RegisterInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(new AppError("VALIDATION", "Please fix the errors below.", zodToDetails(parsed.error)));
  }
  const { email, password } = parsed.data;
  const name = parsed.data.name ?? null;

  const existing = await deps.repos.users.findByEmail(email);
  if (existing) {
    return err(duplicateEmail());
  }

  const passwordHash = await deps.hasher.hash(password);
  const user: UserRecord = {
    id: uuidv7(),
    email,
    name,
    passwordHash,
    emailVerifiedAt: null,
    createdAt: ctx.now(),
  };
  const workspace: WorkspaceRecord = {
    id: uuidv7(),
    name: personalWorkspaceName(name ?? displayNameFromEmail(email)),
    slug: await uniqueWorkspaceSlug(deps, email),
    plan: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: ctx.now(),
  };
  const membership = {
    workspaceId: workspace.id,
    userId: user.id,
    role: "owner" as const,
  };

  try {
    // Atomic per M1 acceptance: user + workspace + owner membership or nothing.
    await deps.repos.registration.createAccount({ user, workspace, membership });
  } catch (error) {
    if (isUniqueViolation(error)) return err(duplicateEmail());
    throw error; // programmer/infra error — may cross the module boundary (spec §3)
  }

  const sessionToken = await startSession(ctx, deps, user.id);
  return ok({ user, workspace, sessionToken });
}

export async function loginUser(
  ctx: Ctx,
  deps: IdentityDeps,
  input: unknown,
): Promise<Result<LoginOutput>> {
  const parsed = LoginInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(new AppError("VALIDATION", "Please fix the errors below.", zodToDetails(parsed.error)));
  }
  const { email, password } = parsed.data;

  const user = await deps.repos.users.findByEmail(email);
  // Same error for unknown email and wrong password — no account enumeration.
  if (!user || !user.passwordHash) return err(invalidCredentials());
  const passwordOk = await deps.hasher.verify(password, user.passwordHash);
  if (!passwordOk) return err(invalidCredentials());

  const primary = await primaryWorkspace(deps, user.id);
  const sessionToken = await startSession(ctx, deps, user.id);
  return ok({
    user,
    workspace: primary?.workspace ?? null,
    role: primary?.role ?? null,
    sessionToken,
  });
}

export async function logoutUser(
  ctx: Ctx,
  deps: IdentityDeps,
  input: { token: string },
): Promise<Result<{ revoked: boolean }>> {
  if (input.token.length === 0) return ok({ revoked: false });
  const revoked = await deps.repos.sessions.deleteByTokenHash(sha256(input.token));
  return ok({ revoked });
}

export async function validateSession(
  ctx: Ctx,
  deps: IdentityDeps,
  input: { token: string },
): Promise<Result<AuthenticatedSession>> {
  const tokenHash = sha256(input.token);
  const found = await deps.repos.sessions.findWithUserByTokenHash(tokenHash);
  if (!found) return err(new AppError("FORBIDDEN", "Authentication required."));

  // Copy: the repo may hand out its stored object.
  const session: SessionRecord = { ...found.session };
  const user = found.user;
  const nowMs = ctx.now().getTime();

  if (session.expiresAt.getTime() <= nowMs) {
    await deps.repos.sessions.deleteByTokenHash(tokenHash);
    return err(new AppError("FORBIDDEN", "Your session has expired. Please log in again."));
  }

  // Sliding expiry (M1 acceptance): extend while the session is still valid,
  // at most once per SESSION_UPDATE_AGE_MS of activity.
  const remainingMs = session.expiresAt.getTime() - nowMs;
  if (remainingMs < SESSION_MAX_AGE_MS - SESSION_UPDATE_AGE_MS) {
    session.expiresAt = new Date(nowMs + SESSION_MAX_AGE_MS);
    await deps.repos.sessions.touch(session.id, session.expiresAt);
  }

  const primary = await primaryWorkspace(deps, user.id);
  return ok({ session, user, workspace: primary?.workspace ?? null, role: primary?.role ?? null });
}

// --- internals -------------------------------------------------------------

async function startSession(ctx: Ctx, deps: IdentityDeps, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await deps.repos.sessions.create({
    id: uuidv7(),
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(ctx.now().getTime() + SESSION_MAX_AGE_MS),
    createdAt: ctx.now(),
  });
  return token;
}

/**
 * SPEC-NOTE: M1 uses the user's oldest membership as the active workspace.
 * A workspace switcher arrives with multi-workspace support (later milestone).
 */
async function primaryWorkspace(
  deps: IdentityDeps,
  userId: string,
): Promise<{ workspace: WorkspaceRecord; role: MembershipRole } | null> {
  const memberships = await deps.repos.memberships.listForUser(userId);
  return memberships[0] ?? null;
}

function duplicateEmail(): AppError {
  return new AppError("CONFLICT", "An account with this email already exists.", [
    { path: "email", message: "An account with this email already exists" },
  ]);
}

function invalidCredentials(): AppError {
  return new AppError("VALIDATION", "Invalid email or password.", [
    { path: "password", message: "Invalid email or password" },
  ]);
}

/** Detects Postgres unique-violation (SQLSTATE 23505 / drizzle/pg surface). */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code === "23505") return true;
  return error instanceof Error && /duplicate key value/i.test(error.message);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function personalWorkspaceName(name: string): string {
  return `${name}'s Workspace`;
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// SPEC-NOTE: shortId/base58 helpers are T02 territory (shared/ids.ts); this
// minimal local version keeps identity self-contained until that lands.
const BASE58 = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

async function uniqueWorkspaceSlug(deps: IdentityDeps, seed: string): Promise<string> {
  const base = slugify(seed);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    if ((await deps.repos.workspaces.findBySlug(candidate)) === null) return candidate;
  }
  return `${base}-${randomSuffix()}${randomSuffix()}`;
}

function slugify(value: string): string {
  const local = value.split("@")[0] ?? value;
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : "workspace";
}

function randomSuffix(): string {
  let out = "";
  for (const byte of randomBytes(4)) out += BASE58[byte % BASE58.length] ?? "1";
  return out;
}
