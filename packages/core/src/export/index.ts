// T18 (issue #18) — public interface of the export module (spec §0.5: modules are
// only consumed through their index).
//
// INTEGRATION-DEBT checklist for the integrator:
//   1. apps/worker/src/index.ts (T17): register the handler on the `exports`
//      queue — see apps/worker/src/jobs/csv-export.ts.
//   2. API route `POST /api/v1/documents/:id/exports` (submissions:read):
//      create the export job row (db repositories/exports.ts), enqueue on the
//      `exports` queue with the payload produced from
//      csvExportJobPayloadSchema, respond 202 with the job id.
//   3. Download route `GET /api/v1/exports/:token`: verifyExportToken →
//      stream ObjectStore.get(payload.key) as text/csv.
//   4. Delete packages/core/src/bridge.ts and re-point Mailer/SubmissionReader
//      imports at T17's integrations surface / T14's submissions repository.
//   5. Swap InMemoryObjectStore for the S3 ObjectStore (see object-store.ts).

export {
  CSV_BOM,
  CSV_EOL,
  buildCsvStream,
  buildCsvToString,
  escapeCsvCell,
  formatCsvValue,
  sanitizeCsvFormula,
  type BuildCsvInput,
  type CsvColumn,
} from "./csv";

export {
  QUESTION_BLOCK_KINDS,
  SYSTEM_COLUMNS,
  SYSTEM_COLUMN_IDS,
  formatAnswerCell,
  questionColumnsFromDocument,
  type BlockLike,
  type QuestionColumn,
  type SelectOption,
} from "./columns";

export {
  EXPORT_LINK_TTL_SECONDS,
  buildExportLink,
  newTokenNonce,
  signExportToken,
  verifyExportToken,
  type ExportTokenPayload,
  type ExportTokenVerifyResult,
} from "./tokens";

export {
  InMemoryObjectStore,
  createS3ObjectStore,
  type ObjectGetResult,
  type ObjectPutInput,
  type ObjectStore,
} from "./object-store";

export {
  csvExportJobPayloadSchema,
  inDateRange,
  parseCsvExportJobPayload,
  runCsvExport,
  type CsvExportConfig,
  type CsvExportDeps,
  type CsvExportInput,
  type CsvExportJobPayload,
  type CsvExportResult,
  type ExportJobStore,
} from "./service";

// INTEGRATION-DEBT: bridge types — replace with T02/T14/T17 surfaces when merged.
export type {
  EnqueueFn,
  Mailer,
  SubmissionReader,
  SubmissionRow,
  SubmissionStreamParams,
} from "../bridge";
