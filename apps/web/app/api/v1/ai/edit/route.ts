// POST /api/v1/ai/edit — instruction + current DocumentBody → proposed ops.
// The response is a PROPOSAL with a reviewable diff. Applying it is the
// client's explicit action (builder PATCH after user confirmation); this
// endpoint never writes to the document. The document body supplied by the
// client is validated against the DocumentBody schema before it is used as
// AI context — nothing beyond that context is sent to the model.
// INTEGRATION-DEBT: once T04 documents land, load the authoritative
// document server-side by docId instead of trusting the client body.
import { NextResponse } from "next/server";
import { AppError, DocumentBody, runAiEdit, zodIssuesToDetails } from "@formforge/core/ai";
import {
  createAiDeps,
  errorBody,
  makeRequestCtx,
  parseEditPayload,
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

  const parsed = parseEditPayload(payload);
  if (!parsed.ok) {
    return NextResponse.json(errorBody(parsed.error), { status: parsed.error.status });
  }

  const documentCheck = DocumentBody.safeParse(parsed.value.document);
  if (!documentCheck.success) {
    return NextResponse.json(
      errorBody({
        code: "VALIDATION",
        message: "document failed DocumentBody validation",
        status: 422,
        details: zodIssuesToDetails(documentCheck.error.issues),
      }),
      { status: 422 },
    );
  }

  const deps = await createAiDeps();
  if (!deps.ok) {
    return NextResponse.json(errorBody(deps.error), { status: deps.error.status });
  }

  const ctx = makeRequestCtx(request, workspace.value);
  const result = await runAiEdit(
    ctx,
    deps.value,
    {
      instruction: parsed.value.instruction,
      document: documentCheck.data,
    },
  );
  if (!result.ok) return toErrorResponse(result.error);

  return NextResponse.json(
    {
      summary: result.value.summary,
      ops: result.value.ops,
      diff: result.value.diff,
      attempts: result.value.attempts,
      quota: result.value.quota,
    },
    { status: 201 },
  );
}
