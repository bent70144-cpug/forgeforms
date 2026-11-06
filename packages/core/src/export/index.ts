// T18 (issue #18) — public interface of the export module (spec §0.5: modules are
// only consumed through their index).
//
// Remaining wiring checklist (tracked in the integration follow-up issue):
//   1. apps/worker/src/index.ts (T17): register the handler on the `exports`
//      queue — see apps/worker/src/jobs/csv-export.ts.  [ISSUE #30: done]
//   2. API route `POST /api/v1/documents/:id/exports` (submissions:read):
//      create the export job row (db repositories/exports.ts), enqueue on the
//      `exports` queue with the payload produced from
//      csvExportJobPayloadSchema, respond 202 with the job id.  [re-ticketed]
//   3. Download route `GET /api/v1/exports/:token`: verifyExportToken →
//      stream ObjectStore.get(payload.key) as text/csv.  [re-ticketed]
//   4. packages/core/src/bridge.ts is retired (issue #30); the ports live in
//      ./ports.ts.
//   5. Swap InMemoryObjectStore for the S3 ObjectStore (see object-store.ts).
//      [re-ticketed]

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

// ISSUE #30: T18 plane ports moved here from the retired core bridge.ts.
export type {
  EnqueueFn,
  ExportSubmissionRow,
  Mailer,
  SubmissionReader,
  SubmissionStreamParams,
} from "./ports";
