// PATCH /api/public/ingest/submissions/:token — save step answers (spec §10.3).
// Honors Idempotency-Key (replay returns the stored response, spec §4).
// SPEC-NOTE: §10.1 pins PATCH /api/public/submissions/:token; see the start
// route note about the ingest/** ownership path.

import { saveStep } from "@formforge/core/submissions";
import { getIngestDeps } from "../../_lib/deps";
import {
  bodyRecord,
  errorResponse,
  idempotencyKeyOf,
  internalErrorResponse,
  logInternalError,
  optString,
  parseAnswers,
  readJsonBody,
  requestCtx,
} from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const ctx = requestCtx(req);
  try {
    const { token } = await params;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = bodyRecord(parsed.body);
    if (!body.ok) return body.response;
    const answers = parseAnswers(body.body.answers);
    if (!answers.ok) return answers.response;

    const deps = await getIngestDeps();
    const result = await saveStep(deps, ctx, {
      token,
      answers: answers.answers,
      currentBlockId: optString(body.body.currentBlockId),
      idempotencyKey: idempotencyKeyOf(req),
    });
    if (!result.ok) return errorResponse(result.error);
    return Response.json(result.value, { status: 200 });
  } catch (error) {
    logInternalError(ctx.requestId, error);
    return internalErrorResponse();
  }
}
