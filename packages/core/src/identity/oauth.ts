// Google sign-in (ticket #5, spec §1 Auth: "Auth.js Google provider behind env
// config"; spec §14.1 Google button).
//
// SPEC-NOTE: T03 deliberately ships its own DB-backed session layer (opaque
// ff_session cookie + sessions table) and auth.config.ts documents that the
// switch to Auth.js "when Google OAuth lands is mechanical". Wiring full
// Auth.js v5 would replace that session stack (two parallel session systems),
// so this module implements the same conceptual provider surface natively: the
// HTTP routes (apps/web/app/api/auth/**) perform the Google OAuth2 code flow
// behind GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env config, and this service
// maps the verified Google profile onto the identity module — creating or
// linking the user — exactly what an Auth.js adapter would.
// INTEGRATION-DEBT: swap-in is mechanical if/when the team standardizes on
// Auth.js; this service is the seam.
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { IdentityDeps } from "./ports";
import type { LoginOutput } from "./service";
import { primaryWorkspace, startSession } from "./service";

export type GoogleProfile = {
  /** Google account email — trusted only from the token-endpoint response. */
  email: string;
  /** Display name from the Google profile; may be empty. */
  name?: string | null;
  /** Google marks account emails verified; mirrored into users.email_verified_at. */
  emailVerified: boolean;
};

export type GoogleSignInOutput = LoginOutput;

/**
 * Create-or-link sign-in for a Google profile:
 *  - existing local user with that email → link (log them in; adopt the
 *    Google-verified flag if the local account is still unverified);
 *  - unknown email → create user (no password — OAuth-only) + personal
 *    workspace + owner membership, atomically, then sign in.
 */
export async function signInWithGoogleProfile(
  ctx: Ctx,
  deps: IdentityDeps,
  profile: GoogleProfile,
): Promise<Result<GoogleSignInOutput>> {
  const email = profile.email.trim().toLowerCase();
  if (email.length === 0) {
    return err(new AppError("VALIDATION", "Google profile has no email.", [
      { path: "email", message: "Google account has no verified email" },
    ]));
  }

  const existing = await deps.repos.users.findByEmail(email);
  if (existing) {
    const adoptVerified = profile.emailVerified && existing.emailVerifiedAt === null;
    if (adoptVerified) {
      await deps.repos.users.markEmailVerified(existing.id, ctx.now());
    }
    const primary = await primaryWorkspace(deps, existing.id);
    const sessionToken = await startSession(ctx, deps, existing.id);
    return ok({
      user: adoptVerified ? { ...existing, emailVerifiedAt: ctx.now() } : existing,
      workspace: primary?.workspace ?? null,
      role: primary?.role ?? null,
      sessionToken,
    });
  }

  const name = profile.name?.trim() || null;
  const user = {
    id: uuidv7(),
    email,
    name,
    passwordHash: null, // OAuth-only account (users.password_hash stays nullable)
    emailVerifiedAt: profile.emailVerified ? ctx.now() : null,
    createdAt: ctx.now(),
  };
  const workspace = {
    id: uuidv7(),
    name: `${name ?? displayNameFromEmail(email)}'s Workspace`,
    slug: await uniqueWorkspaceSlug(deps, email),
    plan: "free" as const,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: ctx.now(),
  };
  await deps.repos.registration.createAccount({
    user,
    workspace,
    membership: { workspaceId: workspace.id, userId: user.id, role: "owner" },
  });
  const sessionToken = await startSession(ctx, deps, user.id);
  return ok({ user, workspace, role: "owner", sessionToken });
}

// --- helpers (mirror service.ts so both flows behave identically) -----------

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

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
