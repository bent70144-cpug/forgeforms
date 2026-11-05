// T18 (issue #18) — BullMQ job handler for the `exports` queue (spec §12):
//   queue: `exports`, job: `csv-export`
//   "Stream rows by cursor to S3, email signed link (7-day expiry)"
//
// INTEGRATION-DEBT (T17 owns apps/worker/src/index.ts — do not edit it here):
//   registration must be added by the lead/T17, e.g.:
//     import { createCsvExportJobHandler, EXPORTS_QUEUE, CSV_EXPORT_JOB,
//              csvExportJobOptions } from "./jobs/csv-export.js";
//     new Worker(EXPORTS_QUEUE, createCsvExportJobHandler({
//       store: s3OrInMemoryStore,          // ObjectStore (S3 impl — see core/export/object-store.ts)
//       mailer,                            // T17 Mailer (@formforge/core/integrations)
//       submissions: submissionsRepo,      // T14 repository adapted to streamByCursor
//       jobs: createExportJobsRepo(db),    // @formforge/db repositories/exports.ts
//       config: { secret: env.SESSION_SECRET, baseUrl: env.PUBLIC_BASE_URL },
//       now: () => new Date(),
//     }), { connection, ... });
//   The API ticket enqueues with: enqueue(EXPORTS_QUEUE, CSV_EXPORT_JOB, payload,
//   csvExportJobOptions(exportId)) after inserting the export_jobs row.

import {
  parseCsvExportJobPayload,
  runCsvExport,
  type CsvExportDeps,
  type CsvExportJobPayload,
} from "@formforge/core/export";

/** Queue name per spec §12. */
export const EXPORTS_QUEUE = "exports";

/** Job name per spec §12. */
export const CSV_EXPORT_JOB = "csv-export";

// SPEC-NOTE: spec §12 defines retry policy only for `email` (5× exponential) and
// `webhooks`; a 10k-row export is resumable-safe (idempotent object key + job
// status row), so 3 attempts / 1 min exponential keeps BullMQ from hot-looping
// transient S3/SMTP failures without masking real errors.
export function csvExportJobOptions(exportId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: "exponential"; delay: number };
  removeOnComplete: { age: number };
  removeOnFail: false;
} {
  return {
    // jobId = exportId → BullMQ dedupes the same export request.
    jobId: exportId,
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: { age: 24 * 60 * 60 },
    removeOnFail: false,
  };
}

/**
 * Creates the `csv-export` worker handler. The payload carries everything the
 * run needs (ids, columns snapshot, filters, recipient) so the worker is
 * self-contained; heavy dependencies arrive via `deps`.
 */
export function createCsvExportJobHandler(
  deps: CsvExportDeps,
): (job: { id?: string; data: unknown }) => Promise<void> {
  return async function handleCsvExportJob(job: { id?: string; data: unknown }): Promise<void> {
    const payload: CsvExportJobPayload = parseCsvExportJobPayload(job.data);
    await runCsvExport(deps, payload);
  };
}
