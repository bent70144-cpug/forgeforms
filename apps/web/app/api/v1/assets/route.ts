// GET /api/v1/assets — workspace asset LIST (builder asset picker, §10/§11).
// Authenticated: session cookie or bearer token (docs:read); the workspace
// ALWAYS comes from the auth context. Newest first, `limit` page (§4 envelope,
// no cursor — the picker shows the most recent media only).
//
// Signed URLs are issued ONLY for clean/skipped assets (§17
// scan-before-download): pending/infected rows carry `download: null` plus
// their scan status so the picker can show state and the UI can retry after
// the worker advances them.
//
// Query: ?purpose=media|upload&limit=1..100 (default limit 50, default = all
// purposes). The response item shape matches GET /api/v1/assets/:id's envelope.

import { AppError, requireScope } from "@formforge/core/api";
import { AssetListQuerySchema } from "@formforge/schema/api";
import { authenticate } from "../_lib/auth";
import { handleApiError, listResponse } from "../_lib/respond";
import { getTenantAssetsRepo, getTenantAssetsService } from "../../../../lib/assets/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: true });
    if (ctx.actor.kind === "token") {
      requireScope(ctx.scopes, "docs:read");
    }

    const url = new URL(req.url);
    const query = AssetListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) throw query.error;

    const repo = getTenantAssetsRepo();
    const service = getTenantAssetsService();

    // Tenant-scoped list (RLS-bound; foreign rows are indistinguishable).
    const rows = await repo.listByWorkspace(ctx.workspaceId, {
      purpose: query.data.purpose,
      limit: query.data.limit,
    });

    const data = await Promise.all(
      rows.map(async (row) => {
        let download: { url: string; expiresInSeconds: number } | null = null;
        try {
          const signed = await service.downloadUrl({ workspaceId: ctx.workspaceId, assetId: row.id });
          download = { url: signed.url, expiresInSeconds: signed.expiresInSeconds };
        } catch (error) {
          // FORBIDDEN = not servable yet (pending/infected) — metadata still
          // flows so the picker can show state; any other error rethrows.
          const code = AppError.is(error) ? error.code : "INTERNAL";
          if (code !== "FORBIDDEN") throw error;
        }
        return {
          asset: {
            id: row.id,
            key: row.key,
            mime: row.mime,
            sizeBytes: row.sizeBytes,
            purpose: row.purpose,
            scanStatus: row.scanStatus,
            variants: row.variants ?? null,
            createdAt: row.createdAt.toISOString(),
          },
          download,
        };
      }),
    );

    return listResponse(data, null);
  } catch (error) {
    return handleApiError(error);
  }
}
