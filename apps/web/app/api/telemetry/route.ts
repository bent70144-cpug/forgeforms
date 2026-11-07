// POST /api/telemetry — §15 builder-event collector (builder audit follow-up
// #9). Sibling of the T19 public beacon (apps/web/app/api/public/beacon) but
// for the AUTHENTICATED app surface (builder / dashboard).
//
// Contract:
//   • POST { events: [{ event, props? }] } — Zod-validated against the §15
//     vocabulary in @formforge/schema/api: strict event-name allowlist +
//     closed per-event prop shapes (ids/counts/statuses ONLY — anything
//     content-looking, extra keys, over-length strings → 422).
//   • Session-authenticated (`allowToken: false`) — telemetry is a browser
//     surface; API tokens have no business POSTing it. This also gives every
//     event a workspace/user scope for free.
//   • Rate limited per workspace+user (60 batch-requests/min) on top of the
//     shared per-session limiter authenticate() already applies — reusing the
//     identity in-memory limiter helper the auth flows use (Redis swap is the
//     shared INTEGRATION-DEBT).
//   • Structured-log each event via the §4 pino logger (requestId +
//     workspaceId bindings, denylist redaction still applies). Ids/counts
//     only — guaranteed upstream by the schema.
//   • NO DB writes: apps/worker's `events` queue is the submission fan-out
//     (BullMQ), not a builder-telemetry sink, and its repositories are still
//     unmerged (T02 INTEGRATION-DEBT). This wave is logging-only by design —
//     cheap, dependency-free, and the client sink drops any non-2xx silently.
//   • 204 on success. Never errors loudly: every failure mode here is a small
//     §4 JSON error the client sink swallows.

import { createLogger } from "@formforge/core";
import type { Ctx } from "@formforge/core/api";
import { TelemetryBatchSchema } from "@formforge/schema/api";
import { authenticate } from "../v1/_lib/auth";
import { handleApiError, jsonError } from "../v1/_lib/respond";
import {
  TELEMETRY_RATE_LIMIT_PER_MINUTE,
  getTelemetryRateLimiter,
} from "@/lib/telemetry/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batches are tiny `{event, props}` pairs — 64 KB is generous. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Rate-limit key principal (session-only route → the user id). */
function principalId(ctx: Ctx): string {
  return ctx.actor.kind === "session" ? ctx.actor.userId : "anon";
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let ctx: Ctx;
  try {
    ctx = await authenticate(req, { allowToken: false });
  } catch (error) {
    return handleApiError(error);
  }

  const decision = getTelemetryRateLimiter().check(
    `telemetry:${ctx.workspaceId}:${principalId(ctx)}`,
  );
  if (!decision.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Telemetry rate limit exceeded: ${TELEMETRY_RATE_LIMIT_PER_MINUTE} requests per minute`,
      [{ path: "retryAfter", message: String(decision.retryAfterSec) }],
    );
  }

  try {
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return jsonError("VALIDATION", "Telemetry payload too large");
    }

    const body: unknown = await req.json().catch(() => null);
    const parsed = TelemetryBatchSchema.safeParse(body);
    if (!parsed.success) {
      // Unknown event name, extra/content-looking props, over-cap strings or
      // batch sizes → 422 VALIDATION with field details (§4 envelope).
      return handleApiError(parsed.error);
    }

    // §4 structured logging — one line per event, ids/counts only (enforced
    // by TelemetryBatchSchema before this loop). Nested under `telemetry` so
    // the logger's denylist redaction keeps applying at any depth.
    const log = createLogger({ requestId: ctx.requestId, workspaceId: ctx.workspaceId });
    for (const event of parsed.data.events) {
      log.info({ telemetry: event }, `telemetry ${event.event}`);
    }

    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
