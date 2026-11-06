// Google OAuth callback (ticket #5): exchange the code, map the Google
// profile onto the identity module (create-or-link user), issue the app
// session cookie. Errors redirect to /login?error=… — no tokens or profile
// data in URLs (spec §4 logging rule).
import { NextResponse, type NextRequest } from "next/server";
import { preAuthCtx, signInWithGoogleProfile } from "@formforge/core/identity";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/auth.config";
import { getIdentityDeps } from "@/lib/auth/container";
import {
  GOOGLE_STATE_COOKIE,
  appOriginFromEnv,
  exchangeGoogleCode,
  googleOAuthConfig,
} from "@/lib/auth/google";

function loginRedirect(error: string): NextResponse {
  const url = new URL("/login", "http://placeholder.local");
  url.searchParams.set("error", error);
  return NextResponse.redirect(url.toString().replace("http://placeholder.local", ""));
}

export async function GET(request: NextRequest) {
  const origin = appOriginFromEnv() ?? request.nextUrl.origin;
  const config = googleOAuthConfig(origin);
  if (!config) return loginRedirect("google_unavailable");

  // Consent declined / aborted → neutral redirect back to the login page.
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) return loginRedirect("google_cancelled");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return loginRedirect("google_state");
  }

  const profile = await exchangeGoogleCode(config, code);
  if (!profile.ok) return loginRedirect("google_failed");

  const result = await signInWithGoogleProfile(preAuthCtx(), getIdentityDeps(), profile.value);
  if (!result.ok) return loginRedirect("google_failed");

  const response = NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));
  response.cookies.set(SESSION_COOKIE_NAME, result.value.sessionToken, sessionCookieOptions());
  response.cookies.delete(GOOGLE_STATE_COOKIE);
  return response;
}
