// POST /api/v1/assets/confirm — confirm a media upload: magic-byte check,
// queue scan (+ image pipeline) (T16, spec §11). Authenticated; the workspace
// comes from the auth context and cross-tenant ids are 404s (fail closed).
//
// Body: { assetId }
//  → 200 { assetId, key, mime, scanStatus, alreadyConfirmed? }

import { requireScope } from "@formforge/core/api";
import { AssetConfirmRequestSchema } from "@formforge/schema/api";
import { authenticate } from "../../_lib/auth";
import { handleApiError, ok } from "../../_lib/respond";
import { getTenantAssetsService } from "../../../../../lib/assets/server";

export const dynamic = "force-dynamic";

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
    const parsed = AssetConfirmRequestSchema.safeParse(json);
    if (!parsed.success) throw parsed.error;

    const service = getTenantAssetsService();
    const result = await service.confirm({
      workspaceId: ctx.workspaceId,
      assetId: parsed.data.assetId,
    });
    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}
