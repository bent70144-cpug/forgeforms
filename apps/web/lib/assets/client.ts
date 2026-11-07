// apps/web/lib/assets/client.ts — browser client for the v1 assets plane
// (builder asset picker, §10; spec §11 contracts):
//
//   1. POST /api/v1/assets/presign  → { assetId, uploadUrl, mime, maxSizeMb, … }
//   2. PUT  uploadUrl with the raw bytes   (direct browser → S3/R2, never proxied;
//      the exact Content-Type the presign returned — mismatches fail the
//      magic-byte check at confirm)
//   3. POST /api/v1/assets/confirm → { assetId, mime, scanStatus } (scan runs
//      async in the worker; "pending" is a normal state, §12)
//
// and GET /api/v1/assets for the Library tab (§4 envelope, §17 signed URLs
// only for clean/skipped rows).
//
// Every function takes an injectable `fetchImpl` (defaults to global fetch)
// so the flow is unit-testable without a network (same posture as
// file-upload's UploadClient seam).

import type { AssetListResponse, ScanStatus } from "@formforge/schema/api";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** POST /api/v1/assets/presign response (schema/api PresignUploadResponse). */
export type PresignUploadResult = {
  assetId: string;
  key: string;
  uploadUrl: string;
  mime: string;
  maxSizeMb: number;
  expiresInSeconds: number;
  scanStatus: ScanStatus;
};

/** POST /api/v1/assets/confirm response (schema/api ConfirmUploadResponse). */
export type ConfirmUploadResult = {
  assetId: string;
  key: string;
  mime: string;
  scanStatus: ScanStatus;
  alreadyConfirmed?: boolean;
};

/** One GET /api/v1/assets row (schema/api AssetListItem). */
export type WorkspaceAsset = AssetListResponse["data"][number];

/** Structural file view — real Files (browser) and test doubles both fit. */
export type UploadableFile = {
  name: string;
  type: string;
  size: number;
  /** Bytes to PUT; real files pass the File itself. */
  body: BodyInit;
};

/** Upload orchestration phases (surfaced as the picker's progress state, §10). */
export type UploadPhase = "presigning" | "uploading" | "confirming";

function errorMessage(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    return parsed.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  fetchImpl: FetchLike,
  fallback: string,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(errorMessage(text, fallback));
  return JSON.parse(text) as T;
}

/** Step 1 — presign a media upload (the workspace comes from the session). */
export async function presignMediaUpload(
  input: { fileName: string; mime: string; sizeBytes: number },
  fetchImpl: FetchLike = fetch,
): Promise<PresignUploadResult> {
  return postJson<PresignUploadResult>(
    "/api/v1/assets/presign",
    { ...input, purpose: "media" },
    fetchImpl,
    "Could not start the upload",
  );
}

/** Step 2 — PUT the bytes straight to the presigned storage URL. */
export async function putUploadToStorage(
  uploadUrl: string,
  file: UploadableFile,
  mime: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const res = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: { "content-type": mime },
    body: file.body,
  });
  if (!res.ok) throw new Error("Upload failed — the file could not be stored");
}

/** Step 3 — confirm (magic-byte check + scan queue; scanStatus starts "pending"). */
export async function confirmMediaUpload(
  input: { assetId: string },
  fetchImpl: FetchLike = fetch,
): Promise<ConfirmUploadResult> {
  return postJson<ConfirmUploadResult>(
    "/api/v1/assets/confirm",
    input,
    fetchImpl,
    "Could not verify the upload",
  );
}

/** Library tab — newest-first workspace media list. */
export async function listWorkspaceAssets(
  query: { purpose?: "media" | "upload"; limit?: number } = {},
  fetchImpl: FetchLike = fetch,
): Promise<WorkspaceAsset[]> {
  const params = new URLSearchParams();
  if (query.purpose) params.set("purpose", query.purpose);
  params.set("limit", String(query.limit ?? 50));
  const res = await fetchImpl(`/api/v1/assets?${params.toString()}`, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(errorMessage(text, "Could not load the asset library"));
  const body = JSON.parse(text) as AssetListResponse;
  return body.data;
}

/**
 * Orchestrates presign → PUT → confirm for one file, reporting each phase so
 * the picker can show honest progress states. Pure transport — no component
 * state — so the flow is testable with a mock fetch (success + every failure).
 */
export async function uploadMediaAsset(
  file: UploadableFile,
  onPhase: (phase: UploadPhase) => void,
  fetchImpl: FetchLike = fetch,
): Promise<ConfirmUploadResult> {
  const mime = file.type !== "" ? file.type : "application/octet-stream";
  onPhase("presigning");
  const presigned = await presignMediaUpload(
    { fileName: file.name, mime, sizeBytes: file.size },
    fetchImpl,
  );
  onPhase("uploading");
  await putUploadToStorage(presigned.uploadUrl, file, presigned.mime, fetchImpl);
  onPhase("confirming");
  return confirmMediaUpload({ assetId: presigned.assetId }, fetchImpl);
}
