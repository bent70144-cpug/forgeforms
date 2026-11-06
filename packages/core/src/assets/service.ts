// T16 (issue #16) — assets upload service (spec §10.1 presign/confirm, §13
// size caps, §12 scan lifecycle, §17 security checklist).
//
// Seam map (all injected, spec §3):
//   store         ObjectStore — presigned PUT/GET, head, readRange, remove
//   repo          AssetRepo   — tenant-scoped asset rows (db-backed in prod)
//   queue         AssetQueue  — `assets` queue publisher (scan / process-image)
//   entitlements  billing.getEntitlements — per-plan upload cap (§13), optional
//
// Lifecycle: pending ─(scan job: clean | infected | skipped-in-dev). Signed
// GET URLs are issued ONLY for clean/skipped assets (§17 "scan before
// download, signed URLs only").

import { z } from "zod";
import { AppError, type ErrorDetail } from "../shared/errors.ts";
import { InMemoryObjectStore, type ObjectStore } from "../shared/object-store.ts";
import { SNIFF_WINDOW_BYTES, familyOf, isAllowedUploadMime, isTypeSpoof, sniffMime } from "./mime.ts";

/** Per-plan upload cap fallback when no entitlements reader is wired (§13: free/pro 10 MB). */
export const DEFAULT_UPLOAD_CAP_MB = 10;
/** Block-level absolute ceiling for the file-upload block (§7.2: maxSizeMb ≤ 10). */
export const MAX_FILE_UPLOAD_BLOCK_MB = 10;
/** Presigned PUT validity — short: the browser uploads immediately after. */
export const UPLOAD_URL_TTL_SECONDS = 600;
/** Signed download validity — configurable; long enough for cached snapshots. */
export const DOWNLOAD_URL_TTL_SECONDS = 3600;

export type AssetPurpose = "media" | "upload";
export type ScanStatus = "pending" | "clean" | "infected" | "skipped";

/** Structural row DTO — packages/db mirrors this shape (no core import there). */
export type AssetRecord = {
  id: string;
  workspaceId: string;
  key: string;
  mime: string;
  sizeBytes: number;
  purpose: AssetPurpose;
  scanStatus: ScanStatus;
  variants?: AssetVariants | null;
  /** Set by confirmUpload — distinguishes "presigned, not uploaded" from
   * "uploaded, scan pending" without overloading scan_status (§6). */
  confirmedAt?: Date | null;
  createdAt: Date;
};

/** Image-variant metadata persisted alongside the asset (spec §12 process-image). */
export type AssetVariant = { key: string; format: "webp" | "avif"; width: number };
export type AssetVariants = {
  width: number;
  height: number;
  variants: AssetVariant[];
  sizes: string;
  blurDataURL: string;
};

export interface AssetRepo {
  insert(row: AssetRecord): Promise<AssetRecord>;
  getById(workspaceId: string, assetId: string): Promise<AssetRecord | null>;
  /** Public plane: the asset id is the only credential available pre-tenant. */
  getByIdUnscoped(assetId: string): Promise<AssetRecord | null>;
  patch(assetId: string, patch: Partial<Omit<AssetRecord, "id" | "workspaceId">>): Promise<AssetRecord | null>;
  remove(assetId: string, workspaceId: string): Promise<boolean>;
}

/** `assets` queue publisher (spec §12). Deterministic jobIds → at-most-once. */
export interface AssetQueue {
  enqueue(jobName: "scan" | "process-image", data: unknown, jobId?: string): Promise<void>;
}

/** Virus scanner seam — dev default has none (→ `skipped`, spec §12). */
export interface VirusScanner {
  scan(input: { key: string }): Promise<"clean" | "infected" | "unavailable">;
}

/** Billing entitlements reader (spec §13) — the ONLY plan source allowed. */
export interface UploadEntitlements {
  getEntitlements(workspaceId: string): Promise<{ fileUploadMaxMb: number }>;
}

export type AssetsServiceDeps = {
  store: ObjectStore;
  repo: AssetRepo;
  queue: AssetQueue;
  entitlements?: UploadEntitlements;
  now: () => Date;
  generateId: () => string;
  /** Override for tests/dev. */
  uploadUrlTtlSeconds?: number;
  downloadUrlTtlSeconds?: number;
};

export type AssetsService = {
  readonly store: ObjectStore;
  readonly repo: AssetRepo;
  presign(input: PresignInput): Promise<PresignOutput>;
  confirm(input: ConfirmInput): Promise<ConfirmOutput>;
  downloadUrl(input: DownloadInput): Promise<DownloadOutput>;
};

/* ------------------------------------------------------------------ *
 * Inputs/outputs (§10.1 bodies)
 * ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PresignInputSchema = z.strictObject({
  workspaceId: z.string().regex(UUID_RE, "workspaceId must be a uuid"),
  purpose: z.enum(["media", "upload"]),
  fileName: z.string().min(1).max(200),
  mime: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(1024 * 1024 * 1024),
});

export type PresignInput = z.infer<typeof PresignInputSchema>;

export type PresignOutput = {
  assetId: string;
  key: string;
  uploadUrl: string;
  /** PUT with this exact Content-Type; mismatches fail the magic-byte check. */
  mime: string;
  maxSizeMb: number;
  expiresInSeconds: number;
  scanStatus: ScanStatus;
};

export const ConfirmInputSchema = z.strictObject({
  /** Authenticated plane passes the ctx workspace; public plane omits it. */
  workspaceId: z.string().regex(UUID_RE).optional(),
  assetId: z.string().min(1).max(200),
});

export type ConfirmInput = z.infer<typeof ConfirmInputSchema>;

export type ConfirmOutput = {
  assetId: string;
  key: string;
  mime: string;
  scanStatus: ScanStatus;
  alreadyConfirmed?: boolean;
};

export const DownloadInputSchema = z.strictObject({
  workspaceId: z.string().regex(UUID_RE).optional(),
  assetId: z.string().min(1).max(200),
});

export type DownloadInput = z.infer<typeof DownloadInputSchema>;

export type DownloadOutput = {
  url: string;
  key: string;
  mime: string;
  sizeBytes: number;
  scanStatus: ScanStatus;
  expiresInSeconds: number;
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Key layout: `<purpose>/<workspaceId>/<assetId>/<fileName>` — deterministic,
 * tenant-prefixed (never guessable across tenants), safe to re-derive.
 */
function objectKeyFor(purpose: AssetPurpose, workspaceId: string, assetId: string, fileName: string): string {
  return `${purpose}/${workspaceId}/${assetId}/${fileName}`;
}

/** Strip any path component / control characters — the name never leaves its key. */
export function sanitizeFileName(raw: string): string {
  // Defense in depth: the file name is a single key segment — anything carrying
  // path separators or dot-dot segments is rejected outright (never silently
  // rewritten, so the author sees their mistake in the error).
  if (raw.includes("/") || raw.includes("\\") || raw.split("..").length > 1) {
    throw AppError.validation("Invalid file name", [
      { path: "fileName", message: "File name must not contain path separators" },
    ]);
  }
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length === 0 || cleaned === ".") {
    throw AppError.validation("Invalid file name", [{ path: "fileName", message: "File name is required" }]);
  }
  return cleaned.slice(0, 200);
}

function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw AppError.fromZodError(parsed.error);
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ *
 * Service
 * ------------------------------------------------------------------ */

export function createAssetsService(deps: AssetsServiceDeps): AssetsService {
  const uploadTtl = deps.uploadUrlTtlSeconds ?? UPLOAD_URL_TTL_SECONDS;
  const downloadTtl = deps.downloadUrlTtlSeconds ?? DOWNLOAD_URL_TTL_SECONDS;

  async function resolveCapMb(workspaceId: string): Promise<number> {
    if (!deps.entitlements) return DEFAULT_UPLOAD_CAP_MB;
    const entitlements = await deps.entitlements.getEntitlements(workspaceId);
    return entitlements.fileUploadMaxMb > 0 ? entitlements.fileUploadMaxMb : DEFAULT_UPLOAD_CAP_MB;
  }

  const service: AssetsService = {
    store: deps.store,
    repo: deps.repo,

    async presign(rawInput): Promise<PresignOutput> {
      const input = parseInput(PresignInputSchema, rawInput);
      const fileName = sanitizeFileName(input.fileName);
      const details: ErrorDetail[] = [];

      // MIME allowlist first (§17): the declared type must be server-allowed.
      if (!isAllowedUploadMime(input.mime)) {
        throw AppError.validation("File type is not allowed", [
          { path: "mime", message: `Files of type "${input.mime}" are not accepted` },
        ]);
      }

      // Size cap BEFORE presigning anything (§13; acceptance: over-cap →
      // VALIDATION before presign). Spec §13: File upload size 10 MB
      // (free/pro), 50 MB (business) via billing entitlements.
      const capMb = await resolveCapMb(input.workspaceId);
      const capBytes = capMb * 1024 * 1024;
      if (input.sizeBytes > capBytes) {
        details.push({ path: "sizeBytes", message: `File exceeds the ${capMb} MB upload limit` });
        throw AppError.validation("Upload exceeds size limit", details);
      }

      const assetId = deps.generateId();
      const key = objectKeyFor(input.purpose, input.workspaceId, assetId, fileName);
      const presigned = await deps.store.presignPut(key, { contentType: input.mime, expiresInSeconds: uploadTtl });
      await deps.repo.insert({
        id: assetId,
        workspaceId: input.workspaceId,
        key,
        mime: input.mime.toLowerCase().split(";")[0]!.trim(),
        sizeBytes: input.sizeBytes,
        purpose: input.purpose,
        scanStatus: "pending",
        createdAt: deps.now(),
      });
      return {
        assetId,
        key,
        uploadUrl: presigned.url,
        mime: input.mime.toLowerCase().split(";")[0]!.trim(),
        maxSizeMb: capMb,
        expiresInSeconds: uploadTtl,
        scanStatus: "pending",
      };
    },

    async confirm(rawInput): Promise<ConfirmOutput> {
      const input = parseInput(ConfirmInputSchema, rawInput);
      const row = input.workspaceId
        ? await deps.repo.getById(input.workspaceId, input.assetId)
        : await deps.repo.getByIdUnscoped(input.assetId);
      if (!row) throw AppError.notFound("Asset not found");

      // Idempotent confirm: lifecycle already advanced (scan may be running).
      if (row.confirmedAt != null || row.scanStatus !== "pending") {
        return { assetId: row.id, key: row.key, mime: row.mime, scanStatus: row.scanStatus, alreadyConfirmed: true };
      }

      const meta = await deps.store.head(row.key);
      if (!meta) {
        throw AppError.validation("Upload not found", [
          { path: "assetId", message: "Uploaded object not found in storage — upload it before confirming" },
        ]);
      }

      // THE security boundary (§17): sniff the leading bytes. Unknown content
      // or a declared-type mismatch marks the asset `infected` (never
      // downloadable) and purges the object.
      const bytes = await deps.store.readRange(row.key, SNIFF_WINDOW_BYTES);
      const sniffed = bytes ? sniffMime(bytes) : null;
      if (sniffed === null || !isAllowedUploadMime(sniffed) || isTypeSpoof(row.mime, sniffed)) {
        await deps.repo.patch(row.id, { scanStatus: "infected" });
        await deps.store.remove(row.key).catch(() => {});
        throw AppError.validation("Upload rejected", [
          {
            path: "mime",
            message: `Content does not match its declared type (magic-byte check: ${sniffed ?? "unknown"})`,
          },
        ]);
      }

      await deps.repo.patch(row.id, { mime: sniffed, confirmedAt: deps.now() });

      // Queue the scan (§12); images also get the variant pipeline.
      await deps.queue.enqueue("scan", { assetId: row.id, workspaceId: row.workspaceId, key: row.key }, `scan:${row.id}`);
      if (familyOf(sniffed) === "image") {
        await deps.queue.enqueue(
          "process-image",
          { assetId: row.id, workspaceId: row.workspaceId, key: row.key, mime: sniffed },
          `process-image:${row.id}`,
        );
      }

      return { assetId: row.id, key: row.key, mime: sniffed, scanStatus: "pending" };
    },

    async downloadUrl(rawInput): Promise<DownloadOutput> {
      const input = parseInput(DownloadInputSchema, rawInput);
      const row = input.workspaceId
        ? await deps.repo.getById(input.workspaceId, input.assetId)
        : await deps.repo.getByIdUnscoped(input.assetId);
      if (!row) throw AppError.notFound("Asset not found");

      // §17: scan before download — pending/infected assets are never served.
      if (row.scanStatus !== "clean" && row.scanStatus !== "skipped") {
        throw AppError.forbidden("Asset is not available for download", [
          { path: "assetId", message: `Scan status is "${row.scanStatus}"` },
        ]);
      }

      const presigned = await deps.store.presignGet(row.key, { expiresInSeconds: downloadTtl });
      if (!presigned) throw AppError.notFound("Asset not found");
      return {
        url: presigned.url,
        key: row.key,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        scanStatus: row.scanStatus,
        expiresInSeconds: downloadTtl,
      };
    },
  };

  return service;
}

// Dev convenience re-export: wiring without S3 env falls back to the in-memory
// store (mirrors objectStoreFromEnv).
export { InMemoryObjectStore };
