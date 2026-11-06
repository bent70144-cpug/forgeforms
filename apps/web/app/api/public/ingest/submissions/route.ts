// POST /api/public/ingest/submissions — start a submission (spec §10.1/§10.3).
// SPEC-NOTE: §10.1 pins the path POST /api/public/submissions; T14's file
// ownership pins apps/web/app/api/public/ingest/**. Add a rewrite from the
// spec path to this handler when merging (no behavior difference).
// Thin handler: parse → service → map AppError → HTTP per §4.

import { startSubmission } from "@formforge/core/submissions";
import { getIngestDeps } from "../_lib/deps";
import {
  bodyRecord,
  clientIp,
  errorResponse,
  idempotencyKeyOf,
  internalErrorResponse,
  logInternalError,
  optRecord,
  optString,
  readJsonBody,
  requestCtx,
  validationResponse,
} from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const ctx = requestCtx(req);
  try {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = bodyRecord(parsed.body);
    if (!body.ok) return body.response;

    const documentId = optString(body.body.documentId);
    if (!documentId) {
      return validationResponse([{ path: "documentId", message: "documentId is required" }]);
    }

    const deps = await getIngestDeps();
    const result = await startSubmission(deps, ctx, {
      documentId,
      hidden: optRecord(body.body.hidden),
      turnstileToken: optString(body.body.turnstileToken),
      // Honeypot field `_hp` must be empty (spec §10.3 Limits).
      honeypot: body.body._hp,
      ip: clientIp(req),
      meta: optRecord(body.body.meta),
      idempotencyKey: idempotencyKeyOf(req),
    });
    if (!result.ok) return errorResponse(result.error);
    return Response.json(result.value, { status: 201 });
  } catch (error) {
    logInternalError(ctx.requestId, error);
    return internalErrorResponse();
  }
}
