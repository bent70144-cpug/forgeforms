// packages/core/src/submissions/index.ts
// Public interface of the submissions module (spec §3: modules expose only
// index.ts — services, types and error classes).

export {
  START_RATE_LIMIT_PER_MINUTE,
  SAVE_RATE_LIMIT_PER_MINUTE,
  MAX_PAYLOAD_BYTES,
  IDEMPOTENCY_TTL_SECONDS,
  payloadSizeError,
  startSubmission,
  saveStep,
  completeSubmission,
} from "./ingest";
export {
  buildQuestionIndex,
  firstQuestionBlockId,
  validateAnswers,
  isRequired,
  isEmptyAnswer,
} from "./blocks";
export {
  InMemorySubmissionsRepo,
  InMemoryIdempotencyStore,
  InMemoryRateLimiter,
  StubTurnstileVerifier,
  CaptureEventQueue,
  InMemoryUsageCounter,
} from "./memory";
export { createBootstrapBlockRegistry } from "./bootstrap-registry";
export type {
  // rows
  SubmissionStatus,
  SubmissionRow,
  NewSubmissionRow,
  AnswerRow,
  AnswerUpsert,
  // seams
  SubmissionsRepo,
  SnapshotReader,
  AnswerSchema,
  BlockFamily,
  BlockInfo,
  BlockRegistry,
  IdempotencyStore,
  StoredIdempotentResponse,
  RateLimiter,
  TurnstileVerifier,
  SubmissionCompletedEvent,
  SubmissionStartedEvent,
  IngestEvent,
  EventQueue,
  UsageCounter,
  IngestDeps,
  IngestRequestCtx,
  // api
  StartInput,
  StartOutput,
  AnswerInput,
  SaveInput,
  SaveOutput,
  CompleteInput,
  CompleteOutput,
  ValidationDetail,
} from "./types";
