// POST /api/public/ingest/submissions/:token/complete — finalize (spec §10.3).
// Idempotency-Key replays the original response; a bare second call on an
// already-completed submission is a CONFLICT (issue #14).
// SPEC-NOTE: §10.1 pins POST /api/public/submissions/:token/complete; see the
// start route note about the ingest/** ownership path.

import { completeSubmission } from "@formforge/core/submissions";
import { getIngestDeps } from "../../../_lib/deps";
import {
  bodyRecord,
  errorResponse,
  idempotencyKeyOf,
  internalErrorResponse,
  logInternalError,
  parseAnswers,
  readJsonBody,
  requestCtx,
} from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
    const result = await completeSubmission(deps, ctx, {
      token,
      answers: answers.answers,
      idempotencyKey: idempotencyKeyOf(req),
    });
    if (!result.ok) return errorResponse(result.error);
    return Response.json(result.value, { status: 200 });
  } catch (error) {
    logInternalError(ctx.requestId, error);
    return internalErrorResponse();
  }
}
