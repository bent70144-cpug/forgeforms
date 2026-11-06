// POST /api/public/uploads/presign — presigned PUT for file answers (T16,
// spec §10.1 public plane + §13 caps). Unauthenticated by design: the
// workspace comes from the PUBLISHED documentId, never from the client.
//
// Body: { documentId, fileName, mime, sizeBytes }
//  → 200 { assetId, key, uploadUrl, mime, maxSizeMb, expiresInSeconds, scanStatus }
// Errors: §4 shape — VALIDATION 422 (allowlist, over-cap, bad name),
// NOT_FOUND 404 (unknown/unpublished document).
//
// The size/MIME gates run BEFORE anything is presigned or persisted; the
// security boundary is the magic-byte check at confirm time.

import { AppError } from "@formforge/core";;
import { sanitizeFileName } from "@formforge/core/assets";
import { PublicUploadPresignRequestSchema } from "@formforge/schema/api";
import { errorResponse, readJsonBody } from "../../ingest/_lib/http";
import { getPublicAssetsDeps } from "../../../../../lib/assets/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonBody(req);
    if (!body.ok) return body.response;
    const parsed = PublicUploadPresignRequestSchema.safeParse(body.body);
    if (!parsed.success) {
      return errorResponse(AppError.fromZodError(parsed.error));
    }

    const deps = getPublicAssetsDeps();
    const workspaceId = await deps.resolvePublishedWorkspace(parsed.data.documentId);
    if (!workspaceId) {
      // Missing / unpublished / foreign documents are indistinguishable (§10.3).
      throw AppError.notFound("Document not found");
    }

    // Rejects over-cap + disallowed mimes with VALIDATION before any presign.
    const result = await deps.service.presign({
      workspaceId,
      purpose: "upload",
      fileName: sanitizeFileName(parsed.data.fileName),
      mime: parsed.data.mime,
      sizeBytes: parsed.data.sizeBytes,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AppError || AppError.is(error)) return errorResponse(error);
    logInternal(error);
    return errorResponse(AppError.internal("Internal server error"));
  }
}

function logInternal(error: unknown): void {
  console.error(JSON.stringify({ level: "error", scope: "uploads.presign", error: String(error) }));
}
