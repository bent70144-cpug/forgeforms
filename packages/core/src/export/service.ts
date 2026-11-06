// T18 (issue #18) — CSV export orchestration (spec §12 `exports`/`csv-export`):
// stream submission rows by cursor → RFC 4180 CSV (one column per question
// block) → ObjectStore → 7-day signed link → `send-export-ready` email.
//
// Contract notes:
//   - every dependency is injected (store, mailer, submissions reader, job store,
//     clock, config) so the flow is unit-testable with fakes;
//   - the submissions reader is expected to apply from/to + tenant scoping in SQL
//     (spec §4/§6); the service filters defensively per row anyway, so the
//     "from/to date filters respected" acceptance criterion holds at this layer;
//   - the email contains the link and metadata only — never answer data;
//   - nothing here logs answer values (spec §4 logging rules).
// SPEC-NOTE: errors are plain `Error`s here; the integrator can map them to the
// T02 AppError (VALIDATION/INTERNAL) at the job boundary without changing this flow.

import { z } from "zod";
import type { ExportSubmissionRow as SubmissionRow, Mailer, SubmissionReader } from "./ports";
import { buildCsvStream } from "./csv";
import { formatAnswerCell, SYSTEM_COLUMN_IDS, type QuestionColumn } from "./columns";
import type { ObjectStore } from "./object-store";
import { buildExportLink, EXPORT_LINK_TTL_SECONDS, newTokenNonce, signExportToken } from "./tokens";

/** Status-transition writer for the export job row (Drizzle impl: @formforge/db repositories/exports). */
export interface ExportJobStore {
  markRunning(exportId: string, workspaceId: string, at: Date): Promise<void>;
  markCompleted(
    exportId: string,
    workspaceId: string,
    data: { rowCount: number; sizeBytes: number; objectKey: string; expiresAt: Date },
    at: Date,
  ): Promise<void>;
  markFailed(exportId: string, workspaceId: string, error: string, at: Date): Promise<void>;
}

export type CsvExportConfig = {
  /** HMAC secret for signed links (wire to SESSION_SECRET/AUTH_SECRET at boot). */
  secret: string;
  /** Public base URL used for the emailed download link (NEXT_PUBLIC_APP_URL / PUBLIC_BASE_URL). */
  baseUrl: string;
  /** Object-key prefix, defaults to "exports". */
  objectPrefix?: string;
  /** Signed-link TTL in seconds, defaults to 7 days (spec §12). */
  linkTtlSeconds?: number;
};

export type CsvExportDeps = {
  store: ObjectStore;
  mailer: Mailer;
  submissions: SubmissionReader;
  jobs: ExportJobStore;
  config: CsvExportConfig;
  /** Injected clock (spec §4: never `new Date()` inside services). */
  now: () => Date;
  /** Structured sink (pino at the edge). Entries never contain answer values. */
  log?: (entry: Record<string, unknown>) => void;
};

export type CsvExportInput = {
  exportId: string;
  workspaceId: string;
  documentId: string;
  documentTitle: string;
  /** Recipient of the `send-export-ready` email (the user who requested the export). */
  recipientEmail: string;
  /** One column per question block — see questionColumnsFromDocument (columns.ts). */
  columns: readonly QuestionColumn[];
  /** Inclusive `completedAt` bounds (spec §11 `POST /documents/:id/exports` `{from?, to?}`). */
  from?: Date | string;
  to?: Date | string;
};

export type CsvExportResult = {
  exportId: string;
  objectKey: string;
  sizeBytes: number;
  rowCount: number;
  link: string;
  token: string;
  expiresAt: Date;
  linkTtlSeconds: number;
};

// ---------------------------------------------------------------------------
// BullMQ job payload (spec §12) — shared by the API route that enqueues the job
// and the worker handler that consumes it.
// ---------------------------------------------------------------------------

const columnSchema = z.object({
  id: z.string().min(1),
  header: z.string().min(1).optional(),
  kind: z.string().optional(),
  label: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});

export const csvExportJobPayloadSchema = z.object({
  exportId: z.uuid(),
  workspaceId: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string().max(500).default(""),
  recipientEmail: z.email(),
  columns: z.array(columnSchema).min(1),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export type CsvExportJobPayload = z.infer<typeof csvExportJobPayloadSchema>;

/** Validates the raw BullMQ job data; throws a ZodError on malformed payloads. */
export function parseCsvExportJobPayload(data: unknown): CsvExportJobPayload {
  return csvExportJobPayloadSchema.parse(data);
}

/**
 * Inclusive date-range check on `completedAt`. Rows without a completion
 * timestamp are excluded whenever a range is given (a range implies "completed
 * in window"); with no range every row passes through.
 */
export function inDateRange(
  completedAt: Date | string | null | undefined,
  from?: Date,
  to?: Date,
): boolean {
  if (from === undefined && to === undefined) return true;
  if (completedAt === null || completedAt === undefined) return false;
  const time = completedAt instanceof Date ? completedAt.getTime() : new Date(completedAt).getTime();
  if (Number.isNaN(time)) return false;
  if (from !== undefined && time < from.getTime()) return false;
  if (to !== undefined && time > to.getTime()) return false;
  return true;
}

/**
 * Runs the full export:
 *   1. mark job running;
 *   2. stream submissions by cursor (from/to passed through + defensively re-checked);
 *   3. stream RFC 4180 CSV (BOM + stable-id headers) into the ObjectStore;
 *   4. sign a 7-day link token and email it (link only — no answer data);
 *   5. mark job completed with rowCount/sizeBytes/objectKey.
 * Any failure marks the job failed and rethrows so BullMQ applies retries.
 */
export async function runCsvExport(deps: CsvExportDeps, input: CsvExportInput): Promise<CsvExportResult> {
  const ttlSeconds = deps.config.linkTtlSeconds ?? EXPORT_LINK_TTL_SECONDS;
  const from = normalizeDate(input.from, "from");
  const to = normalizeDate(input.to, "to");
  const objectKey = `${deps.config.objectPrefix ?? "exports"}/${input.workspaceId}/${input.documentId}/${input.exportId}.csv`;

  await deps.jobs.markRunning(input.exportId, input.workspaceId, deps.now());
  deps.log?.({
    event: "csv_export.started",
    exportId: input.exportId,
    workspaceId: input.workspaceId,
    documentId: input.documentId,
  });

  try {
    const counter = { value: 0 };
    const cursor = deps.submissions.streamByCursor({
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      from,
      to,
    });
    const body = buildCsvStream({
      columns: input.columns,
      rows: mapRows(filterRows(cursor, from, to), input.columns, counter),
      formatCell: formatAnswerCell,
    });
    const { sizeBytes } = await deps.store.put({
      key: objectKey,
      body,
      contentType: "text/csv; charset=utf-8",
    });

    const signedAt = deps.now();
    const token = signExportToken(
      { exportId: input.exportId, key: objectKey, jti: newTokenNonce() },
      { secret: deps.config.secret, now: signedAt, ttlSeconds },
    );
    const link = buildExportLink({ baseUrl: deps.config.baseUrl, token });
    const expiresAt = new Date(signedAt.getTime() + ttlSeconds * 1000);

    await deps.mailer.send({
      to: input.recipientEmail,
      subject: `Your CSV export is ready${input.documentTitle ? ` — ${input.documentTitle}` : ""}`,
      text: [
        `The CSV export for "${input.documentTitle || "your document"}" is ready.`,
        "",
        `Download link (valid until ${expiresAt.toISOString()}):`,
        link,
        "",
        "The link is personal and expires automatically. You can request a new export at any time from the Results screen.",
      ].join("\n"),
    });

    await deps.jobs.markCompleted(
      input.exportId,
      input.workspaceId,
      { rowCount: counter.value, sizeBytes, objectKey, expiresAt },
      deps.now(),
    );
    deps.log?.({
      event: "csv_export.completed",
      exportId: input.exportId,
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      rowCount: counter.value,
      sizeBytes,
    });

    return {
      exportId: input.exportId,
      objectKey,
      sizeBytes,
      rowCount: counter.value,
      link,
      token,
      expiresAt,
      linkTtlSeconds: ttlSeconds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.jobs.markFailed(input.exportId, input.workspaceId, message, deps.now());
    deps.log?.({
      event: "csv_export.failed",
      exportId: input.exportId,
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      error: message,
    });
    throw error;
  }
}

function normalizeDate(value: Date | string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`csv-export: invalid ${field} date`);
  return date;
}

function filterRows(
  rows: AsyncIterable<SubmissionRow>,
  from: Date | undefined,
  to: Date | undefined,
): AsyncIterable<SubmissionRow> {
  return (async function* () {
    for await (const row of rows) {
      if (inDateRange(row.completedAt, from, to)) yield row;
    }
  })();
}

function mapRows(
  rows: AsyncIterable<SubmissionRow>,
  columns: readonly QuestionColumn[],
  counter: { value: number },
): AsyncIterable<Record<string, unknown>> {
  return (async function* () {
    for await (const row of rows) {
      counter.value += 1;
      yield rowToCells(row, columns);
    }
  })();
}

function rowToCells(row: SubmissionRow, columns: readonly QuestionColumn[]): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const column of columns) {
    switch (column.id) {
      case SYSTEM_COLUMN_IDS.submissionId:
        cells[column.id] = row.id;
        break;
      case SYSTEM_COLUMN_IDS.submittedAt:
        cells[column.id] = row.completedAt ?? null;
        break;
      case SYSTEM_COLUMN_IDS.status:
        cells[column.id] = row.status;
        break;
      default:
        // Question answers keyed by block id (spec §6 `answers`).
        cells[column.id] = row.answers?.[column.id] ?? null;
    }
  }
  return cells;
}
