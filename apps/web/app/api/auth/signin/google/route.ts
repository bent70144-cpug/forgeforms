// Google sign-in entry point (ticket #5). Redirects to Google's consent
// screen when GOOGLE_CLIENT_ID is configured; 404s otherwise (the button is
// hidden server-side, so this only ever fires on a stale/misconfigured client).
import { NextResponse, type NextRequest } from "next/server";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_MAX_AGE_SECONDS,
  appOriginFromEnv,
  buildGoogleAuthorizeUrl,
  googleOAuthConfig,
  newGoogleState,
} from "@/lib/auth/google";

export async function GET(request: NextRequest) {
  const origin = appOriginFromEnv() ?? request.nextUrl.origin;
  const config = googleOAuthConfig(origin);
  if (!config) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Google sign-in is not configured." } },
      { status: 404 },
    );
  }

  // Double-submit CSRF state: random value in an httpOnly cookie AND in the
  // authorize URL; the callback requires both to match.
  const state = newGoogleState();
  const response = NextResponse.redirect(buildGoogleAuthorizeUrl(config, state));
  response.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GOOGLE_STATE_MAX_AGE_SECONDS,
  });
  return response;
}
