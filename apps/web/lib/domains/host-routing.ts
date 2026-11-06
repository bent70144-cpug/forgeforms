// apps/web/lib/domains/host-routing.ts
// Host → documentId resolution used by BOTH sides of the custom-domain flow
// (issue #24, spec §10.1):
//  - the edge middleware (resolver with a tiny TTL cache — the middleware
//    runtime cannot import node-only Drizzle code, so it reads the routing
//    table through /api/internal/host-route);
//  - the node route handler (the Drizzle routing table from @formforge/db).
// Pure helpers here are unit-tested; the middleware stays a thin wrapper.
//
// EDGE RULE: import the deep, pure routing helpers — NOT the
// @formforge/core/domains barrel. The barrel exports the service, which pulls
// billing → stripe signature (node:crypto) into the edge bundle and webpack
// fails the middleware build ("UnhandledSchemeError: node:crypto"), 500-ing
// every page. `routing.ts` is pure (see its header) and edge-safe.
import { isAppHost, normalizeRequestHost } from '@formforge/core/domains/routing';

/** TTL for middleware-side host lookups (§13 plan changes move slowly; DNS even slower). */
export const HOST_ROUTE_TTL_MS = 15_000;

/** The env slice the helpers read — kept structural so tests pass plain records. */
export type EnvLike = Partial<Record<string, string | undefined>>;

/** The deployment's own hosts — never rewritten to _host (auth/marketing app). */
export function appHostsFromEnv(env: EnvLike = process.env): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1']);
  for (const key of ['NEXT_PUBLIC_APP_URL', 'PUBLIC_BASE_URL']) {
    const raw = env[key];
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname);
    } catch {
      // invalid URL in env → ignore; env validation catches real misconfig
    }
  }
  if (env.VERCEL_URL) hosts.add(env.VERCEL_URL);
  return [...hosts];
}

/** App-owned path prefixes that must never be host-rewritten. */
export const APP_PATH_PREFIXES = [
  '/api/',
  '/_host/',
  '/_next/',
  '/dashboard',
  '/settings',
  '/login',
  '/register',
  '/templates',
  '/embed',
  '/p/',
  '/d/',
] as const;

/** True when a request MIGHT be a custom-hostname render (pure, tested). */
export function shouldAttemptHostRewrite(
  host: string,
  pathname: string,
  appHosts: readonly string[],
): boolean {
  if (!host) return false;
  if (isAppHost(host, appHosts)) return false;
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (APP_PATH_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix))) {
    return false;
  }
  return true;
}

export type HostRouteResolver = (host: string) => Promise<string | null>;

/**
 * Middleware-side resolver: asks the node runtime for the routing entry and
 * caches the answer per-isolate for HOST_ROUTE_TTL_MS. Failures resolve to
 * null (request passes through — custom domains must never 500 the edge).
 */
export function createFetchHostRouteResolver(origin: string, fetchImpl: typeof fetch = fetch): HostRouteResolver {
  const cache = new Map<string, { value: string | null; expiresAt: number }>();
  return async (host) => {
    const normalized = normalizeRequestHost(host);
    if (!normalized) return null;
    const now = Date.now();
    const cached = cache.get(normalized);
    if (cached && cached.expiresAt > now) return cached.value;
    let value: string | null = null;
    try {
      const response = await fetchImpl(
        `${origin}/api/internal/host-route?host=${encodeURIComponent(normalized)}`,
        { cache: 'no-store' },
      );
      if (response.ok) {
        const body = (await response.json()) as { documentId?: string | null };
        value = typeof body.documentId === 'string' ? body.documentId : null;
      }
    } catch {
      value = null;
    }
    cache.set(normalized, { value, expiresAt: Date.now() + HOST_ROUTE_TTL_MS });
    return value;
  };
}

/** Node-side routing table accessor — lives in the route handler file
 * (apps/web/app/api/internal/host-route/route.ts), which statically imports
 * the Drizzle stores. This module stays free of node-only imports so the edge
 * middleware can safely use the pure helpers above. */
