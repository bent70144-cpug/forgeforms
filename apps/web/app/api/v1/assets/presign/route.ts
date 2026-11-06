// POST /api/v1/assets/presign — media upload (T16, spec §11 "Media upload",
// §10.1 presign semantics). Authenticated: session cookie or bearer token
// (docs:write); the workspace ALWAYS comes from the auth context.
//
// Body: { fileName, mime, sizeBytes, purpose? }   (purpose: media|upload,
//        default "media" — authoring-plane images for hero/gallery/...)
//  → 200 { assetId, key, uploadUrl, mime, maxSizeMb, expiresInSeconds, scanStatus }

import { requireScope } from "@formforge/core/api";
import { sanitizeFileName } from "@formforge/core/assets";
import { AssetPresignRequestSchema } from "@formforge/schema/api";
import { authenticate } from "../../_lib/auth";
import { handleApiError, ok } from "../../_lib/respond";
import { getTenantAssetsService } from "../../../../../lib/assets/server";

export const dynamic = "force-dynamic";

/** Bearer actors must carry docs:write (spec §11); sessions pass (role = T04). */
function requireWriteScope(ctx: { actor: { kind: string }; scopes: readonly string[] }): void {
  if (ctx.actor.kind === "token") {
    requireScope(ctx.scopes, "docs:write");
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: true });
    requireWriteScope(ctx);
    const json: unknown = await req.json().catch(() => null);
    const parsed = AssetPresignRequestSchema.safeParse(json);
    if (!parsed.success) throw parsed.error;

    const service = getTenantAssetsService();
    const result = await service.presign({
      workspaceId: ctx.workspaceId,
      purpose: parsed.data.purpose,
      fileName: sanitizeFileName(parsed.data.fileName),
      mime: parsed.data.mime,
      sizeBytes: parsed.data.sizeBytes,
    });
    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
