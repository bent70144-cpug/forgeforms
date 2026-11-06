// packages/core/src/export/ports.ts
// T18 CSV-export plane ports — ISSUE #30: moved verbatim from the retired
// core `bridge.ts` (they were merged in with the T18 lead drop and belong to
// this module, not to a bridge file).
//
// SPEC-NOTE: `ExportSubmissionRow` is the STREAM DTO the reader yields (it
// carries `answers`, and dates may arrive as ISO strings straight from the
// CSV query). It is intentionally NOT the submissions-plane `SubmissionRow`
// from @formforge/core/submissions (that one is the normalized Drizzle row
// with `publicToken`/`meta` and strict `Date` columns).
//
// SPEC-NOTE: `Mailer` here is the THROWING transport contract the export
// flow was built against ("errors are plain Errors at this layer; the job
// boundary maps them to AppError"). It is deliberately simpler than the
// Result-returning `Mailer` in @formforge/core/integrations.

/** A submission row streamed by cursor for CSV export (spec §12). */
export type ExportSubmissionRow = {
  id: string;
  workspaceId: string;
  documentId: string;
  /** Version of the document the submission answered. */
  versionId: string;
  /** "draft" | "completed" | "spam" (spec §6). Exports stream "completed" rows. */
  status: string;
  /** Answers keyed by question block id. */
  answers: Record<string, unknown>;
  /** Logic variables (score, price, …). */
  variables: Record<string, unknown>;
  /** Hidden fields / UTM capture. */
  hidden: Record<string, unknown>;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
};

export type SubmissionStreamParams = {
  workspaceId: string;
  documentId: string;
  /** Inclusive lower bound on `completedAt`. */
  from?: Date;
  /** Inclusive upper bound on `completedAt`. */
  to?: Date;
};

export interface SubmissionReader {
  streamByCursor(params: SubmissionStreamParams): AsyncIterable<ExportSubmissionRow>;
}

/** Throwing mail transport contract used by the CSV export flow. */
export type Mailer = {
  send(message: { to: string; subject: string; text: string; html?: string }): Promise<void>;
};

export type EnqueueFn = (
  queue: string,
  jobName: string,
  data: unknown,
  opts?: { jobId?: string; delayMs?: number },
) => Promise<unknown>;
