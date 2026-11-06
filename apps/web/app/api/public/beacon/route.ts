// T19 (issue #19) — public analytics beacon, SIBLING of the ingest surface.
// SPEC-NOTE: spec §10.1 names the batch beacon `POST /api/public/a`, but that
// path sits under apps/web/app/api/public/ingest/** which is owned by T14 in
// flight — so per the T19 ownership rules this sibling ships at
// /api/public/beacon. Once T14 merges, the integrator can add an alias route at
// /api/public/a re-exporting this handler (handlers are pure wrappers over the
// injected AnalyticsService).
//
// Contract (issue #19 + spec §4/§10/§13):
//   • POST  — JSON batch { documentId, events: [{ type, sessionId, blockId?, props?, ts? }] }
//   • GET   — 1x1 transparent GIF pixel (`?d=<docId>&e=<type>&s=<sessionId>&b=<blockId>`)
//   • No cookies are read or set, IPs are never read, session ids are sha256-hashed.
//   • Permissive CORS: beacons fire cross-origin from customer sites/embeds.
//   • Malformed batches → 422 with the §4 error body; pixel GET never errors.

import { AppError } from "../../../../../../packages/core/src/bridge";
import {
  createAnalyticsService,
  pixelEventFromQuery,
  type AnalyticsService,
} from "../../../../../../packages/core/src/analytics";
import { getDefaultAnalyticsRepository } from "../../../../../../packages/db/src/repositories/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** §10.3 payload cap, applied to beacon batches too. */
const MAX_PAYLOAD_BYTES = 256 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** 1x1 transparent GIF (43 bytes). */
const PIXEL_GIF = Uint8Array.from(
  Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  ),
);

// Composition root: no cookies, no IP, no request-derived identity — the only
// caller input is the JSON/query payload handled by the service below.
function getAnalyticsService(): AnalyticsService | null {
  const repo = getDefaultAnalyticsRepository();
  if (!repo) return null;
  return createAnalyticsService({ repo, ctx: systemCtx(() => new Date()) });
}

function errorResponse(error: AppError): Response {
  // §4 API error body: codes map to HTTP status (422/402/…).
  const status =
    error.code === "VALIDATION"
      ? 422
      : error.code === "PLAN_LIMIT"
        ? 402
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : error.code === "RATE_LIMITED"
              ? 429
              : error.code === "CONFLICT"
                ? 409
                : 500;
  return Response.json(
    { error: { code: error.code, message: error.message, details: error.details ?? null } },
    { status, headers: CORS_HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  const service = getAnalyticsService();
  if (!service) {
    return Response.json(
      { error: { code: "INTERNAL", message: "Analytics storage unavailable" } },
      { status: 500, headers: CORS_HEADERS },
    );
  }
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_PAYLOAD_BYTES) {
      throw new AppError("VALIDATION", "Beacon payload too large");
    }
    const body: unknown = await request.json();
    await service.ingestBatch(body);
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error);
    if (error instanceof SyntaxError) {
      return errorResponse(new AppError("VALIDATION", "Invalid JSON in beacon batch"));
    }
    console.error(
      JSON.stringify({ level: "error", msg: "beacon ingest failed", error: String(error) }),
    );
    return Response.json(
      { error: { code: "INTERNAL", message: "Beacon ingest failed" } },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const service = getAnalyticsService();
  if (service) {
    // Best-effort: a broken pixel must never break the host page, so any
    // validation/storage failure still returns the GIF below.
    const event = pixelEventFromQuery(
      {
        d: url.searchParams.get("d") ?? undefined,
        e: url.searchParams.get("e") ?? undefined,
        s: url.searchParams.get("s") ?? undefined,
        b: url.searchParams.get("b") ?? undefined,
      },
      () => new Date(),
    );
    if (event) {
      try {
        await service.recordEvents([event]);
      } catch (error) {
        console.error(
          JSON.stringify({ level: "error", msg: "pixel beacon dropped", error: String(error) }),
        );
      }
    }
  }
  return new Response(PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// INTEGRATION-DEBT (lead): full Ctx arrives with T03/T04 session wiring; the
// analytics plane is unauthenticated/public, so a system ctx is correct here.
function systemCtx(now: () => Date): import("@formforge/core").Ctx {
  return {
    workspaceId: "system",
    actor: { type: "system", id: "analytics" },
    requestId: "analytics-" + Math.random().toString(36).slice(2, 10),
    now,
  };
}
