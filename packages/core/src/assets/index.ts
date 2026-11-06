// @formforge/core — assets module public interface (spec §1/§6/§10.1/§12/§17).
// Modules must only be consumed through this file (spec §0.5).

// Upload service (presign / confirm / signed downloads)
export {
  DEFAULT_UPLOAD_CAP_MB,
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_FILE_UPLOAD_BLOCK_MB,
  UPLOAD_URL_TTL_SECONDS,
  createAssetsService,
  sanitizeFileName,
  ConfirmInputSchema,
  DownloadInputSchema,
  PresignInputSchema,
  type AssetPurpose,
  type AssetQueue,
  type AssetRecord,
  type AssetRepo,
  type AssetVariant,
  type AssetVariants,
  type AssetsService,
  type AssetsServiceDeps,
  type ConfirmInput,
  type ConfirmOutput,
  type DownloadInput,
  type DownloadOutput,
  type PresignInput,
  type PresignOutput,
  type ScanStatus,
  type UploadEntitlements,
  type VirusScanner,
} from "./service.ts";

// Magic bytes + allowlist (security boundary, spec §17)
export {
  DEFAULT_UPLOAD_MIME_ALLOWLIST,
  SNIFF_WINDOW_BYTES,
  familyOf,
  isAllowedUploadMime,
  isTypeSpoof,
  sniffMime,
} from "./mime.ts";

// Image variant pipeline (spec §12 process-image; T21 conformance)
export {
  IMAGE_FORMATS,
  IMAGE_SIZES_DEFAULT,
  SRCSET_SIZES_ATTR,
  blurPlaceholder,
  imageDimensions,
  isRasterImageMime,
  planImageVariants,
  resolveImageAssetRef,
  srcSetFor,
  variantKey,
  type AssetRowLike,
  type ImageDimensions,
  type PlannedVariants,
} from "./variants.ts";

// Object storage port (canonical home; export/object-store.ts re-exports)
export {
  InMemoryObjectStore,
  createS3ObjectStore,
  objectStoreFromEnv,
  s3ObjectStoreConfigFromEnv,
  type ObjectGetResult,
  type ObjectMeta,
  type ObjectPutInput,
  type ObjectStore,
  type PresignPutInput,
  type PresignResult,
  type S3ObjectStoreConfig,
} from "../shared/object-store.ts";
