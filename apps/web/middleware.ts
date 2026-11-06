import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/auth.config";
import { appHostsFromEnv, createFetchHostRouteResolver, shouldAttemptHostRewrite } from "@/lib/domains/host-routing";
import { publicPageHeadersFor } from "@/lib/security/csp";

// M1 auth gate + T24 custom-domain routing (spec §2 middleware.ts:
// "host → document routing, auth gate").
//
// T29 (spec §17): public pages also get CSP + hardening headers — see
// lib/security/csp.ts for the policy rationale (nonce policy on the dynamic
// embed plane, host-allowlist policy on ISR-cached planes).
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

/** Edge-runtime-safe per-request nonce (base64 of a random UUID). */
function requestNonce(): string {
  return btoa(crypto.randomUUID());
}

export async function middleware(request: NextRequest) {
  const gated = authGate(request);
  if (gated) return gated;

  const { pathname } = request.nextUrl;

  // T29 (spec §17): CSP + nosniff + referrer policy on public pages. Applied
  // BEFORE the custom-host branch so a rewrite response below can reuse it.
  const securityHeaders = publicPageHeadersFor(pathname, requestNonce());

  const host = request.headers.get("host") ?? "";
  if (shouldAttemptHostRewrite(host, pathname, appHostsFromEnv())) {
    const documentId = await createFetchHostRouteResolver(request.nextUrl.origin)(host);
    if (documentId) {
      const url = request.nextUrl.clone();
      url.pathname = `/_host${pathname === "/" ? "/index" : pathname}`;
      const headers = new Headers(request.headers);
      headers.set("x-ff-document-id", documentId);
      headers.set("x-ff-custom-host", host);
      const response = NextResponse.rewrite(url, { request: { headers } });
      // Custom-host render = the /p/:slug plane (ISR-cached document HTML).
      if (securityHeaders) {
        for (const [key, value] of Object.entries(securityHeaders)) {
          response.headers.set(key, value);
        }
      }
      return response;
    }
  }

  const response = NextResponse.next();
  if (securityHeaders) {
    for (const [key, value] of Object.entries(securityHeaders)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export const config = {
  matcher: [
    // M1 auth gate paths… (/forgot and /reset-password are reachable both
    // logged-out and mid-recovery — no gate, matching the auth pages' open
    // access.)
    "/dashboard/:path*",
    "/login",
    "/register",
    // …plus every page path so custom hostnames reach the T24 rewrite
    // (api/_next/_host/static excluded — see shouldAttemptHostRewrite).
    "/((?!api/|_next/static|_next/image|_host/|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
