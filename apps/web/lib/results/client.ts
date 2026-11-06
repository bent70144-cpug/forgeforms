// T15 — the seam between the Results UI and (upcoming) T14 ingest data.
// The UI only ever talks to `ResultsClient`; T14 lands behind `FetchResultsClient`
// while fixtures/mock power development and tests.

import type {
  DocumentSummary,
  ListSubmissionsParams,
  SubmissionDTO,
  SubmissionsPage,
  SummaryResponse,
} from "./types";

/** spec §4 example — `?limit=50&cursor=`. */
export const DEFAULT_PAGE_SIZE = 50;
/** Hard cap so a runaway UI can't request the whole table. */
export const MAX_PAGE_SIZE = 500;

/** Error codes from spec §4 (`AppError.code`); API maps them to HTTP status. */
export type ApiErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "INTERNAL";

export class ResultsApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ResultsApiError";
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code] ?? 500;
  }
}

const DEFAULT_STATUS: Record<ApiErrorCode, number | undefined> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
  INTERNAL: 500,
};

/**
 * The only surface the Results UI depends on. Mirrors spec §11:
 *   GET /documents/:id                      (docs:read)
 *   GET /documents/:id/submissions          (submissions:read, cursor)
 *   GET /documents/:id/submissions/:sid     (submissions:read)
 *   GET /documents/:id/summary              (submissions:read)
 */
export interface ResultsClient {
  /** Document snapshot — question labels come from `body` blocks. */
  getDocument(documentId: string): Promise<DocumentSummary>;
  listSubmissions(
    documentId: string,
    params?: ListSubmissionsParams,
  ): Promise<SubmissionsPage>;
  getSubmission(documentId: string, submissionId: string): Promise<SubmissionDTO>;
  getSummary(documentId: string): Promise<SummaryResponse>;
}

/** Human-readable text for an error, safe to render. */
export function describeError(err: unknown): string {
  if (err instanceof ResultsApiError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
