// T16 (issue #16) — BullMQ job handler for the `assets` queue, job
// `process-image` (spec §12: "WebP/AVIF variants").
//
// Pipeline (packages/core/assets variants.ts):
//   1. read the file header (store.readRange — no full-object download);
//   2. parse intrinsic dimensions (PNG/GIF/JPEG/WebP byte-exact; AVIF needs
//      the transcoder — see INTEGRATION-DEBT below);
//   3. plan the responsive ladder (webp+avif at each size < intrinsic width);
//   4. persist the plan as the asset row's `variants` JSON — the renderer
//      resolves it to `srcSet` + `sizes` + `blurDataURL` through
//      resolveImageAssetRef (T21 ImageAssetRef conformance).
//
// INTEGRATION-DEBT: re-encoding (sharp/r2) is not available in this build.
// The plan references sibling keys (`<base>.<width>w.<format>`) that the
// transcoder will fill; until then signed URLs for the variants 404 in S3
// while the ORIGINAL still renders (variants are additive to `src`).

import { AppError, err, ok, type Result } from "@formforge/core/bridge";
import {
  imageDimensions,
  isRasterImageMime,
  planImageVariants,
} from "@formforge/core/assets";
import type { WorkerDeps } from "../ports";
import { parseScanJobData } from "./assets-scan";

/**
 * Header bytes needed for a reliable dimension parse. JPEG SOF markers sit
 * after APP0/APP1 segments (EXIF thumbnails can push them deep), so a 64 KB
 * window covers every real-world case without streaming the whole file.
 */
export const IMAGE_HEADER_WINDOW_BYTES = 65_536;

/** `assets` / `process-image` job data — produced by the upload-confirm service. */
export type ProcessImageJobData = {
  assetId: string;
  workspaceId: string;
  key: string;
  mime: string;
};

export function parseProcessImageJobData(data: unknown): Result<ProcessImageJobData, AppError> {
  const base = parseScanJobData(data);
  if (!base.ok) return base;
  const mime = typeof (data as Record<string, unknown>).mime === "string"
    ? (data as { mime: string }).mime
    : null;
  if (!mime) return err(new AppError("VALIDATION", "process-image.mime is required"));
  return ok({ ...base.value, mime });
}

export async function processProcessImageJob(
  deps: WorkerDeps,
  _jobId: string | undefined,
  data: unknown,
): Promise<Result<{ assetId: string; variantsStored: boolean }, AppError>> {
  const parsed = parseProcessImageJobData(data);
  if (!parsed.ok) return parsed;

  const { assetId, key, workspaceId } = parsed.value;
  const row = await deps.assets.getByIdUnscoped(assetId);
  if (!row) {
    return err(new AppError("NOT_FOUND", `asset row missing for process-image job ${assetId}`));
  }
  // Only raster images get a ladder; the row keeps its (already sniffed) mime.
  if (!isRasterImageMime(row.mime)) {
    deps.logger.warn("assets.process-image.skipped-mime", { assetId, mime: row.mime, workspaceId });
    return ok({ assetId, variantsStored: false });
  }
  if (row.variants) {
    return ok({ assetId, variantsStored: true }); // idempotent re-run
  }

  const header = await deps.store.readRange(key, IMAGE_HEADER_WINDOW_BYTES);
  const dims = header ? imageDimensions(row.mime, header) : null;
  if (!dims) {
    // Unparseable header (AVIF, exotic containers): no pure-TS decoder — the
    // transcoder supplies dimensions later. Not an error: the original renders.
    deps.logger.warn("assets.process-image.no-dimensions", { assetId, mime: row.mime, workspaceId });
    return ok({ assetId, variantsStored: false });
  }

  const plan = planImageVariants(key, dims);
  await deps.assets.patch(assetId, { variants: plan });
  deps.logger.info("assets.process-image.planned", {
    assetId,
    workspaceId,
    width: plan.width,
    height: plan.height,
    variants: plan.variants.length,
  });
  return ok({ assetId, variantsStored: true });
}
