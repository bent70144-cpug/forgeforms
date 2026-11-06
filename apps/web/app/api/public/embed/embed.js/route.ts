// Serves the FormForge embed loader (issue #22): GET /api/public/embed/embed.js
//
// The response is plain JavaScript with wildcard CORS so any host page can load
// it from a <script src> tag (script tags are not subject to CORS; the headers
// exist for fetch-based consumers and CDNs). Versioned by path — breaking
// changes ship under a new file name, never in place.
//
// INTEGRATION-DEBT: awaiting T-pub (public snapshot + ingest endpoints). The
// loader and /embed/:docId already degrade gracefully (graceful "nothing to
// embed" fallback) when those routes are absent.
import { EMBED_LOADER_V1 } from "./loader";

const RESPONSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/javascript; charset=utf-8",
  // Short client cache, longer CDN cache; embed updates propagate within minutes.
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "X-Content-Type-Options": "nosniff",
};

export function GET(): Response {
  return new Response(EMBED_LOADER_V1, { status: 200, headers: RESPONSE_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
}
