// T15 — in-memory ResultsClient over deterministic fixtures.
// Speaks the exact cursor contract of spec §4 so the UI state machine is
// exercised end-to-end: opaque cursor, filter/sort binding, VALIDATION errors
// on mismatched cursors — the same behaviour T14's route must expose.

import { buildSummary } from "./aggregate";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ResultsApiError, type ResultsClient } from "./client";
import { FIXTURE_DOCUMENT, buildFixtureSubmissions, submittedAtOf } from "./fixtures";
import type {
  DocumentSummary,
  ListSubmissionsParams,
  StatusFilter,
  SubmissionDTO,
  SubmissionsPage,
  SummaryResponse,
} from "./types";
import { sortKeyOf } from "./pagination";

interface CursorPayload {
  o: number;
  f: string;
  s: string;
}

/** Unicode-safe base64url (no Buffer dependency — runs on edge + browser). */
function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const payload: unknown = JSON.parse(json);
    if (
      payload !== null &&
      typeof payload === "object" &&
      typeof (payload as CursorPayload).o === "number" &&
      typeof (payload as CursorPayload).f === "string" &&
      typeof (payload as CursorPayload).s === "string"
    ) {
      return payload as CursorPayload;
    }
  } catch {
    // fall through
  }
  throw new ResultsApiError("VALIDATION", "Malformed cursor — refetch from the first page");
}

export interface MockResultsClientOptions {
  /** Artificial latency so loading skeletons are exercisable. Default 0. */
  latencyMs?: number;
  /** Override fixtures (tests). */
  submissions?: SubmissionDTO[];
  document?: DocumentSummary;
  /** Injectable clock (tests). */
  now?: () => number;
}

export class MockResultsClient implements ResultsClient {
  private readonly latencyMs: number;
  private readonly doc: DocumentSummary;
  private readonly submissions: SubmissionDTO[];
  private readonly now: () => number;

  constructor(options: MockResultsClientOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.doc = options.document ?? FIXTURE_DOCUMENT;
    this.now = options.now ?? Date.now;
    this.submissions = (options.submissions ?? buildFixtureSubmissions({ now: this.now() }))
      .slice()
      .sort((a, b) => submittedAtOf(b).localeCompare(submittedAtOf(a)));
  }

  private async tick(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }

  async getDocument(_documentId: string): Promise<DocumentSummary> {
    await this.tick();
    return this.doc;
  }

  async listSubmissions(
    _documentId: string,
    params: ListSubmissionsParams = {},
  ): Promise<SubmissionsPage> {
    await this.tick();
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit ?? DEFAULT_PAGE_SIZE));
    const status: StatusFilter = params.status ?? "all";
    const sort = params.sort ?? "newest";

    let rows = this.submissions;
    if (status !== "all") rows = rows.filter((r) => r.status === status);
    rows = rows
      .slice()
      .sort((a, b) =>
        sort === "newest"
          ? sortKeyOf(b).localeCompare(sortKeyOf(a))
          : sortKeyOf(a).localeCompare(sortKeyOf(b)),
      );

    let offset = 0;
    if (params.cursor) {
      const payload = decodeCursor(params.cursor);
      if (payload.f !== status || payload.s !== sort) {
        throw new ResultsApiError(
          "VALIDATION",
          "Cursor was built for a different filter or sort — refetch from the first page",
        );
      }
      offset = Math.max(0, Math.floor(payload.o));
    }

    const page = rows.slice(offset, offset + limit);
    const nextCursor =
      offset + limit < rows.length ? encodeCursor({ o: offset + limit, f: status, s: sort }) : null;
    return { data: page, nextCursor };
  }

  async getSubmission(_documentId: string, submissionId: string): Promise<SubmissionDTO> {
    await this.tick();
    const found = this.submissions.find((s) => s.id === submissionId);
    if (!found) throw new ResultsApiError("NOT_FOUND", `Submission ${submissionId} not found`);
    return found;
  }

  async getSummary(_documentId: string): Promise<SummaryResponse> {
    await this.tick();
    return buildSummary(this.doc.body.blocks, this.submissions, new Date(this.now()).toISOString());
  }
}
