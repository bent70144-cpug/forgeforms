// Google OAuth2 plumbing (ticket #5: "Auth.js Google provider behind env
// config").
//
// SPEC-NOTE: the provider flow is implemented natively (authorize → token
// exchange → profile → signInWithGoogleProfile) instead of installing
// Auth.js v5, because T03 ships its own DB-backed session layer and running
// Auth.js in parallel would mean two competing session systems. The env
// contract matches the spec/auth.js convention: GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET (+ optional GOOGLE_REDIRECT_URI / APP_URL), and the
// button/flow are entirely absent when GOOGLE_CLIENT_ID is unset.
// The pure helpers below are unit-tested; the routes are thin wrappers.
import { randomBytes } from "node:crypto";
import { AppError, err, ok, type Result } from "@formforge/core/bridge";
import type { GoogleProfile } from "@formforge/core/identity";

export const GOOGLE_STATE_COOKIE = "ff_oauth_state";
export const GOOGLE_STATE_MAX_AGE_SECONDS = 600; // 10 minutes

export const GOOGLE_AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPE = "openid email profile";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** Absolute origin used for OAuth redirects (APP_URL env or the request). */
export function appOriginFromEnv(): string | null {
  const value = process.env.APP_URL;
  return typeof value === "string" && value.length > 0 ? value.replace(/\/+$/, "") : null;
}

/**
 * Reads the OAuth env config. Returns null when GOOGLE_CLIENT_ID is unset —
 * callers hide the Google button (server-rendered conditional) and the
 * routes 404, per the acceptance criteria.
 */
export function googleOAuthConfig(origin?: string): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (typeof clientId !== "string" || clientId.length === 0) return null;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (typeof clientSecret !== "string" || clientSecret.length === 0) return null;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? `${origin ?? appOriginFromEnv() ?? "http://localhost:3000"}/api/auth/callback/google`;
  return { clientId, clientSecret, redirectUri };
}

/** CSRF state for the authorize redirect: random, single-use via cookie compare. */
export function newGoogleState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildGoogleAuthorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("state", state);
  // Google returns the account chooser even for single-account users.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

// --- id_token + code exchange ------------------------------------------------

type IdTokenPayload = {
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
};

/**
 * Parse (not verify — the token arrives directly from Google's token endpoint
 * over TLS, never from the client) the id_token JWT payload.
 */
export function parseGoogleIdToken(idToken: string): Result<GoogleProfile> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return err(new AppError("VALIDATION", "id_token is not a JWT."));
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as IdTokenPayload;
    const email = typeof payload.email === "string" ? payload.email : "";
    if (email.length === 0) return err(new AppError("VALIDATION", "id_token has no email."));
    return ok({
      email,
      name: typeof payload.name === "string" && payload.name.length > 0 ? payload.name : null,
      emailVerified: payload.email_verified === true,
    });
  } catch (cause) {
    return err(new AppError("VALIDATION", `id_token parse failed: ${(cause as Error)?.message ?? "unknown"}`));
  }
}

export type TokenExchangeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/** Exchange the authorization code for an id_token (fetch injectable for tests). */
export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<GoogleProfile>> {
  let response: TokenExchangeResponse;
  try {
    response = (await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    }) as unknown) as TokenExchangeResponse;
  } catch (cause) {
    return err(new AppError("INTERNAL", `google token endpoint unreachable: ${(cause as Error)?.message ?? "unknown"}`));
  }
  if (!response.ok) {
    return err(new AppError("INTERNAL", `google token exchange failed with status ${response.status}`));
  }
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") {
    return err(new AppError("INTERNAL", "google token response missing id_token"));
  }
  return parseGoogleIdToken(body.id_token);
}
