// INTEGRATION-DEBT: awaiting T02/T14/T17 — minimal stand-in types for the pieces this
// module needs from parallel tickets. The integrator MUST delete this file and re-point
// imports to the real surfaces once they land:
//   - Ctx / AppError kernel            → T02  (@formforge/core shared kernel)
//   - submissions repository           → T14  (@formforge/db repositories)
//   - Mailer (Resend)                  → T17  (@formforge/core/integrations)
//   - BullMQ enqueue                   → T17  (queue topology)
// Everything here is intentionally structural (no runtime code) so the swap is
// type-compatible at the wiring site.

/**
 * A submission row as streamed for export (spec §6 `submissions` + joined `answers`).
 * `answers` is keyed by block id (`answers.block_id`). Dates may arrive as `Date`
 * (pg driver) or ISO strings — consumers must coerce defensively.
 */
export type SubmissionRow = {
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

/**
 * Cursor-based submission reader (spec §4 pagination). Implementations (T14) are
 * expected to apply `from`/`to` and tenant scoping in SQL; the CSV export service
 * additionally filters defensively per row.
 */
export interface SubmissionReader {
  streamByCursor(params: SubmissionStreamParams): AsyncIterable<SubmissionRow>;
}

/** Minimal mailer surface (T17 lands the real one over Resend, spec §12 `email` queue). */
export interface Mailer {
  send(message: { to: string; subject: string; text: string; html?: string }): Promise<void>;
}

/** Minimal enqueue surface (T17 owns the BullMQ topology, spec §12). */
export type EnqueueFn = (
  queue: string,
  jobName: string,
  data: unknown,
  opts?: { jobId?: string; delayMs?: number },
) => Promise<unknown>;
