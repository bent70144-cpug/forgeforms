// GET /api/v1/assets/:id — asset metadata + a SIGNED download URL (T16).
// Signed downloads only (spec §17): no public bucket, no unsigned reads — the
// URL is a short-TTL presigned GET issued only for clean/skipped assets
// (scan-before-download). Pending/infected assets return `download: null`
// with the scan status so clients can retry after the worker advances them.

import { AppError, requireScope } from "@formforge/core/api";
import { authenticate } from "../../_lib/auth";
import { handleApiError, ok } from "../../_lib/respond";
import { getTenantAssetsService } from "../../../../../lib/assets/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  route: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await authenticate(req, { allowToken: true });
    if (ctx.actor.kind === "token") {
      requireScope(ctx.scopes, "docs:read");
    }
    const { id } = await route.params;
    const service = getTenantAssetsService();

    // Tenant-scoped row (foreign ids are indistinguishable from missing).
    const row = await service.repo.getById(ctx.workspaceId, id);
    if (!row) throw AppError.notFound("Asset not found");

    let download: { url: string; expiresInSeconds: number } | null = null;
    try {
      const signed = await service.downloadUrl({ workspaceId: ctx.workspaceId, assetId: id });
      download = { url: signed.url, expiresInSeconds: signed.expiresInSeconds };
    } catch (error) {
      // FORBIDDEN = scan not servable yet (pending/infected) — metadata still
      // flows so the UI can show state; any other error rethrows.
      const code = AppError.is(error) ? error.code : "INTERNAL";
      if (code !== "FORBIDDEN") throw error;
    }

    return ok({
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
    });
  } catch (error) {
    return handleApiError(error);
  }
}
