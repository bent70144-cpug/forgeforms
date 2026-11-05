// POST /api/v1/ai/draft — prompt → DocumentBody draft (spec §15 M8).
// Order enforced by core: entitlement + monthly quota gate BEFORE the
// provider call; PLAN_LIMIT → HTTP 402 with capability=ai (spec §13).
// INTEGRATION-DEBT: awaiting T01 session auth (see lib/ai/server.ts).
import { NextResponse } from "next/server";
import { AppError, runAiDraft } from "@formforge/core/ai";
import {
  createAiDeps,
  errorBody,
  makeRequestCtx,
  parseDraftPayload,
  resolveWorkspaceId,
} from "../../../../../lib/ai/server";

export const runtime = "nodejs";

function toErrorResponse(error: AppError): NextResponse {
  return NextResponse.json(errorBody(error), { status: error.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const workspace = resolveWorkspaceId(request);
  if (!workspace.ok) {
    return NextResponse.json(errorBody(workspace.error), {
      status: workspace.error.status,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      errorBody({ code: "VALIDATION", message: "Body must be JSON", status: 422 }),
      { status: 422 },
    );
  }

  const parsed = parseDraftPayload(payload);
  if (!parsed.ok) {
    return NextResponse.json(errorBody(parsed.error), { status: parsed.error.status });
  }

  const deps = await createAiDeps();
  if (!deps.ok) {
    return NextResponse.json(errorBody(deps.error), { status: deps.error.status });
  }

  const ctx = makeRequestCtx(request, workspace.value);
  const result = await runAiDraft(ctx, deps.value, parsed.value);
  if (!result.ok) return toErrorResponse(result.error);

  return NextResponse.json(
    {
      body: result.value.body,
      attempts: result.value.attempts,
      quota: result.value.quota,
    },
    { status: 201 },
  );
}
