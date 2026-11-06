// T18 (issue #18) — object storage seam for finished CSV files (spec §12: "stream
// rows by cursor to S3"). The service depends on this narrow interface only;
// production wires S3, tests/dev use the in-memory implementation.
//
// T16 (issue #16) INTEGRATION: the canonical port now lives in
// `shared/object-store.ts` (assets extended it with head/readRange/remove/
// presignPut/presignGet and the real @aws-sdk/client-s3 implementation,
// resolving this file's INTEGRATION-DEBT). This module re-exports it so T18's
// public surface (`@formforge/core/export`) is unchanged.

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
