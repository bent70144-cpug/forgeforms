import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/auth.config";
import { appHostsFromEnv, createFetchHostRouteResolver, shouldAttemptHostRewrite } from "@/lib/domains/host-routing";

// M1 auth gate + T24 custom-domain routing (spec §2 middleware.ts:
// "host → document routing, auth gate").
//
// SPEC-NOTE: cookie-presence check only — sessions live in Postgres, so full
// validation (sliding expiry, revocation) happens server-side via
// validateSession() in server components and route handlers.
//
// Custom hostname flow (issue #24, spec §10.1): on a NON-app host, resolve
// Host → documentId through the routing table (verified domains only) and
// rewrite to /_host/[...path]. Unknown/unrouted hosts pass through untouched;
// the middleware runtime cannot talk to Postgres, so the lookup goes through
// /api/internal/host-route with a small TTL cache (lib/domains/host-routing).

function authGate(request: NextRequest): NextResponse | null {
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

  return null;
}

export async function middleware(request: NextRequest) {
  const gated = authGate(request);
  if (gated) return gated;

  const host = request.headers.get("host") ?? "";
  if (shouldAttemptHostRewrite(host, request.nextUrl.pathname, appHostsFromEnv())) {
    const documentId = await createFetchHostRouteResolver(request.nextUrl.origin)(host);
    if (documentId) {
      const url = request.nextUrl.clone();
      url.pathname = `/_host${request.nextUrl.pathname === "/" ? "/index" : request.nextUrl.pathname}`;
      const headers = new Headers(request.headers);
      headers.set("x-ff-document-id", documentId);
      headers.set("x-ff-custom-host", host);
      return NextResponse.rewrite(url, { request: { headers } });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // M1 auth gate paths…
    "/dashboard/:path*",
    "/login",
    "/register",
    // …plus every page path so custom hostnames reach the T24 rewrite
    // (api/_next/_host/static excluded — see shouldAttemptHostRewrite).
    "/((?!api/|_next/static|_next/image|_host/|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
