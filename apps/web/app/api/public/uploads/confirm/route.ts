// POST /api/public/uploads/confirm — confirm an uploaded file, run the
// magic-byte check and queue the scan (T16, spec §10.1 public plane).
//
// Body: { assetId, documentId? }
//  → 200 { assetId, key, mime, scanStatus, alreadyConfirmed? }
// Errors: VALIDATION 422 (spoofed/unknown content — the asset is marked
// `infected` and its object purged), VALIDATION when the object was never
// uploaded, NOT_FOUND 404 (unknown asset id).
//
// The asset id (unguessable uuid) is the only public-plane credential: the
// workspace is resolved from the asset row, never from the client.

import { AppError } from "@formforge/core/bridge";
import { PublicUploadConfirmRequestSchema } from "@formforge/schema/api";
import { errorResponse, readJsonBody } from "../../ingest/_lib/http";
import { getPublicAssetsDeps } from "../../../../../lib/assets/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonBody(req);
    if (!body.ok) return body.response;
    const parsed = PublicUploadConfirmRequestSchema.safeParse(body.body);
    if (!parsed.success) {
      return errorResponse(AppError.fromZodError(parsed.error));
    }

    const deps = getPublicAssetsDeps();
    // ConfirmInputSchema allows an optional workspaceId — the public plane
    // MUST NOT accept one (it would be a cross-tenant oracle): strip it and
    // resolve the workspace from the asset row via getByIdUnscoped.
    const result = await deps.service.confirm({ assetId: parsed.data.assetId });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AppError || AppError.is(error)) return errorResponse(error);
    logInternal(error);
    return errorResponse(AppError.internal("Internal server error"));
  }
}

function logInternal(error: unknown): void {
  console.error(JSON.stringify({ level: "error", scope: "uploads.confirm", error: String(error) }));
}
