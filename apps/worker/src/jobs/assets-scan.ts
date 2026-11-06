// T16 (issue #16) — BullMQ job handler for the `assets` queue, job `scan`
// (spec §12: "ClamAV scan (or `skipped` in dev)").
//
// Lifecycle (spec §6): pending → clean | infected | skipped.
//   clean       AV reports the object clean → asset becomes downloadable
//               (signed URLs only, service enforces §17).
//   infected    AV reports malware → status infected AND the object is purged
//               from storage (defense in depth on top of the download gate).
//   unavailable No AV in this environment (dev/sandbox) → `skipped`, exactly
//               the §12 "or `skipped` in dev" branch.
//
// The handler is idempotent: only `pending` rows advance, so a BullMQ retry
// after a crash between scan and patch cannot double-purge or flip a verdict.
//
// INTEGRATION-DEBT (same posture as the other processors): the real
// repository wiring lands with T02's db client in src/index.ts —
//   assets: createAssetsRepository(createDb(config.databaseUrl)),
//   store:  objectStoreFromEnv(process.env),
//   scanner: clamavScannerFromEnv(process.env)  // dev default → "unavailable"

import { AppError, err, ok, type Result } from "@formforge/core";;
import type { WorkerDeps } from "../ports";

/** `assets` / `scan` job data — produced by the upload-confirm service. */
export type ScanJobData = {
  assetId: string;
  workspaceId: string;
  key: string;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScanJobData(data: unknown): Result<ScanJobData, AppError> {
  if (!isRecord(data)) return err(new AppError("VALIDATION", "scan job data must be an object"));
  const assetId = asString(data.assetId);
  const workspaceId = asString(data.workspaceId);
  const key = asString(data.key);
  if (!assetId) return err(new AppError("VALIDATION", "scan.assetId is required"));
  if (!workspaceId) return err(new AppError("VALIDATION", "scan.workspaceId is required"));
  if (!key) return err(new AppError("VALIDATION", "scan.key is required"));
  return ok({ assetId, workspaceId, key });
}

export async function processScanJob(
  deps: WorkerDeps,
  _jobId: string | undefined,
  data: unknown,
): Promise<Result<{ assetId: string; scanStatus: string }, AppError>> {
  const parsed = parseScanJobData(data);
  if (!parsed.ok) return parsed;

  const { assetId, key } = parsed.value;
  const row = await deps.assets.getByIdUnscoped(assetId);
  if (!row) {
    return err(new AppError("NOT_FOUND", `asset row missing for scan job ${assetId}`));
  }
  // Idempotency: confirm() may already have marked the row (e.g. a spoof was
  // caught between enqueue and delivery) — never advance a non-pending row.
  if (row.scanStatus !== "pending") {
    return ok({ assetId, scanStatus: row.scanStatus });
  }

  const verdict = await deps.scanner.scan({ key });
  if (verdict === "infected") {
    await deps.assets.patch(assetId, { scanStatus: "infected" });
    // Purge the payload — the download gate already refuses `infected`, but
    // the bytes must not linger in the bucket (§17 defense in depth).
    await deps.store.remove(key).catch(() => undefined);
    deps.logger.info("assets.scan.infected", { assetId, key, workspaceId: row.workspaceId });
    return ok({ assetId, scanStatus: "infected" });
  }
  if (verdict === "unavailable") {
    // Dev/sandbox: no AV → `skipped` (spec §12), still downloadable by the
    // signed-URL gate (clean | skipped are the servable states).
    await deps.assets.patch(assetId, { scanStatus: "skipped" });
    deps.logger.info("assets.scan.skipped", { assetId, key, workspaceId: row.workspaceId });
    return ok({ assetId, scanStatus: "skipped" });
  }
  await deps.assets.patch(assetId, { scanStatus: "clean" });
  deps.logger.info("assets.scan.clean", { assetId, key, workspaceId: row.workspaceId });
  return ok({ assetId, scanStatus: "clean" });
}
