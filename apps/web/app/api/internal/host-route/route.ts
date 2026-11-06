// GET /api/internal/host-route?host=<hostname>
// Node-runtime lookup backing the edge middleware (spec §10.1): returns the
// routed documentId for a VERIFIED custom hostname, null otherwise. Unverified
// domains are never present in the routing table, so this endpoint can never
// leak an unrouted host. Internal: not part of the public API contract.
import { NextResponse } from 'next/server';
import { normalizeRequestHost } from '@formforge/core/domains';
import { getDomainsStoresFromEnv } from '@formforge/db/repositories/domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const host = new URL(req.url).searchParams.get('host') ?? '';
  const hostname = normalizeRequestHost(host);
  if (!hostname) {
    return NextResponse.json({ documentId: null }, { headers: { 'cache-control': 'no-store' } });
  }
  try {
    const routing = getDomainsStoresFromEnv().routing;
    const documentId = await routing.get(hostname);
    return NextResponse.json(
      { documentId: documentId ?? null },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    // Database unavailable → fail closed: no mapping, no rewrite.
    return NextResponse.json(
      { documentId: null },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }
}
