// Assets / uploads API schemas (issue #16, spec §10.1 public upload routes +
// §11 `POST /assets/presign|confirm`). Zod single source for the upload
// surface and the OpenAPI document.
//
// SECURITY NOTES:
// - The public presign body carries the DOCUMENT id, never a workspaceId: the
//   server resolves the workspace from the PUBLISHED document (§10.3 posture).
// - The public confirm body carries the asset id only — the workspace is
//   resolved from the asset row (unguessable uuid = the credential).
// - Size/MIME gates live in @formforge/core/assets (the service re-validates);
//   these schemas only shape the transport.
import { z } from 'zod';

/** Upload purposes (spec §6 assets.purpose). */
export const AssetPurposeSchema = z.enum(['media', 'upload']);
export type AssetPurpose = z.infer<typeof AssetPurposeSchema>;

/** POST /api/public/uploads/presign (spec §10.1). */
export const PublicUploadPresignRequestSchema = z.object({
  documentId: z.string().min(1).max(200),
  fileName: z.string().min(1).max(200),
  mime: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});
export type PublicUploadPresignRequest = z.infer<typeof PublicUploadPresignRequestSchema>;

/** POST /api/public/uploads/confirm (spec §10.1). documentId is accepted for
 * client correlation but is NOT an authorization input. */
export const PublicUploadConfirmRequestSchema = z.object({
  assetId: z.string().min(1).max(200),
  documentId: z.string().max(200).optional(),
});
export type PublicUploadConfirmRequest = z.infer<typeof PublicUploadConfirmRequestSchema>;

/** POST /api/v1/assets/presign (spec §11 "Media upload"). */
export const AssetPresignRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  mime: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  purpose: AssetPurposeSchema.default('media'),
});
export type AssetPresignRequest = z.infer<typeof AssetPresignRequestSchema>;

/** POST /api/v1/assets/confirm (spec §11). */
export const AssetConfirmRequestSchema = z.object({
  assetId: z.string().min(1).max(200),
});
export type AssetConfirmRequest = z.infer<typeof AssetConfirmRequestSchema>;

/** GET /api/v1/assets/:id response (`download: null` while not servable). */
export const AssetDownloadSchema = z.object({
  url: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});
export type AssetDownload = z.infer<typeof AssetDownloadSchema>;

/* -------------------------------- responses ------------------------------- */

export const ScanStatusSchema = z.enum(['pending', 'clean', 'infected', 'skipped']);
export type ScanStatus = z.infer<typeof ScanStatusSchema>;

/** presign response — `uploadUrl` is a presigned PUT (direct browser → S3). */
export const PresignUploadResponseSchema = z.object({
  assetId: z.string(),
  key: z.string(),
  uploadUrl: z.string(),
  mime: z.string(),
  maxSizeMb: z.number().int().positive(),
  expiresInSeconds: z.number().int().positive(),
  scanStatus: ScanStatusSchema,
});
export type PresignUploadResponse = z.infer<typeof PresignUploadResponseSchema>;

/** confirm response — magic bytes re-derived the mime; scan runs async. */
export const ConfirmUploadResponseSchema = z.object({
  assetId: z.string(),
  key: z.string(),
  mime: z.string(),
  scanStatus: ScanStatusSchema,
  alreadyConfirmed: z.boolean().optional(),
});
export type ConfirmUploadResponse = z.infer<typeof ConfirmUploadResponseSchema>;

/** Asset metadata (GET /api/v1/assets/:id). */
export const AssetSchema = z.object({
  id: z.string(),
  key: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  purpose: AssetPurposeSchema,
  scanStatus: ScanStatusSchema,
  variants: z.unknown().nullable(),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const AssetEnvelopeSchema = z.object({
  asset: AssetSchema,
  download: AssetDownloadSchema.nullable(),
});
export type AssetEnvelope = z.infer<typeof AssetEnvelopeSchema>;

/* --------------------------------- list ----------------------------------- */

/** GET /api/v1/assets query — workspace media list (builder asset picker, §10). */
export const AssetListQuerySchema = z.object({
  purpose: AssetPurposeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AssetListQuery = z.infer<typeof AssetListQuerySchema>;

/** One list row: metadata + a signed URL ONLY while servable (scan-before-download, §17). */
export const AssetListItemSchema = z.object({
  asset: AssetSchema,
  download: AssetDownloadSchema.nullable(),
});
export type AssetListItem = z.infer<typeof AssetListItemSchema>;

/** GET /api/v1/assets response (§4 pagination envelope; no cursor — limit page only). */
export const AssetListResponseSchema = z.object({
  data: z.array(AssetListItemSchema),
  nextCursor: z.string().nullable(),
});
export type AssetListResponse = z.infer<typeof AssetListResponseSchema>;
