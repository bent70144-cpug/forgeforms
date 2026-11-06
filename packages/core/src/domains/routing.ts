/**
 * T24 — routing-table helpers for the middleware Host → documentId mapping
 * (spec §10.1 "GET * on custom hostname"; §2 middleware.ts responsibilities).
 *
 * Pure logic only — the middleware (edge runtime) imports this module plus the
 * routing-table PORT TYPE, never a concrete store (node-only deps stay out of
 * the edge bundle).
 */
import { normalizeHostname } from './hostname.ts';
import type { DomainsRoutingTable } from './ports.ts';

/** Cache-key vocabulary for the host route entries (used by the CDN purge path). */
export const hostRouteKey = (hostname: string): string => `host:${hostname}`;

/**
 * Normalize a request Host header for lookups: lowercase, strip port, strip a
 * single trailing dot. Mirrors {@link normalizeHostname} for the header case.
 */
export function normalizeRequestHost(host: string): string {
  return normalizeHostname(host);
}

/** True when the request host is one of the deployment's own hosts (never rewritten). */
export function isAppHost(host: string, appHosts: readonly string[]): boolean {
  const normalized = normalizeRequestHost(host);
  return appHosts.some((candidate) => normalizeRequestHost(candidate) === normalized);
}

/**
 * Middleware seam: resolve a Host header to a routed documentId via the
 * routing table. Returns null for unknown/unrouted hosts (the middleware then
 * lets the request pass through untouched).
 */
export async function resolveHostDocumentId(
  table: Pick<DomainsRoutingTable, 'get'>,
  host: string,
): Promise<string | null> {
  const hostname = normalizeRequestHost(host);
  if (hostname.length === 0) return null;
  return table.get(hostname);
}
