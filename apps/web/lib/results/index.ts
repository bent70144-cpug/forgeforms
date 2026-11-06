// T15 — public surface of the results data layer.

import { FetchResultsClient } from "./fetch-client";
import { MockResultsClient } from "./mock-client";
import type { ResultsClient } from "./client";

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ResultsApiError, describeError } from "./client";
export type { ApiErrorCode, ResultsClient } from "./client";
export { FetchResultsClient } from "./fetch-client";
export { MockResultsClient } from "./mock-client";
export { FIXTURE_DOCUMENT, FIXTURE_BLOCK_IDS, buildFixtureSubmissions } from "./fixtures";
export {
  aggregateBlock,
  aggregateSubmissions,
  buildSummary,
  classifyNps,
  summaryCountsOf,
  tallyNps,
} from "./aggregate";
export {
  createInitialPaginationState,
  mergePolledRows,
  paginationReducer,
  sortKeyOf,
} from "./pagination";
export { csvSafeCell, displayCell, truncateLabel } from "./labels";
export {
  formatAnswer,
  formatDateTime,
  formatDateTimeShort,
  formatPercent,
  isQuestionBlock,
  isEmptyAnswer,
  optionLabel,
  optionsOf,
  questionLabel,
  ratingScaleOf,
} from "./format";
export * from "./types";

/**
 * Build the client for the current environment.
 * SPEC-NOTE: default stays "mock" (deterministic fixtures) while T14's
 * `/api/v1/documents/:id/submissions` is still being built in parallel; flip
 * the default to "fetch" once T14 merges. Operators can force the live API
 * today with NEXT_PUBLIC_RESULTS_MODE=fetch (+ optional NEXT_PUBLIC_API_BASE).
 */
export function createResultsClient(): ResultsClient {
  const mode = (process.env.NEXT_PUBLIC_RESULTS_MODE ?? "mock").trim().toLowerCase();
  if (mode === "fetch" || mode === "live" || mode === "api") {
    return new FetchResultsClient({
      baseUrl: process.env.NEXT_PUBLIC_API_BASE || "/api/v1",
    });
  }
  return new MockResultsClient({ latencyMs: 250 });
}
