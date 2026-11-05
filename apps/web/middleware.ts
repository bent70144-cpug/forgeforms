import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/auth.config";

// M1 auth gate (spec §2 middleware.ts).
// SPEC-NOTE: spec §2 also assigns host → document routing to this file; that
// lands with the public plane (M3). Only the auth gate lives here for now.
// SPEC-NOTE: cookie-presence check only — sessions live in Postgres, so full
// validation (sliding expiry, revocation) happens server-side via
// validateSession() in server components and route handlers.
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (hasSession && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register"],
};
