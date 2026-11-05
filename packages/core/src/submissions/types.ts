// packages/core/src/submissions/types.ts
// Ports (seams) for the public ingest service — T14 (issue #14).
// Services depend only on these interfaces; concrete implementations are
// injected by apps/web (drizzle/redis/bullmq) or tests (in-memory fakes).

import type { LogicEvaluate, Snapshot } from "../bridge";

export type { AppError, LogicEvaluate, Result, Snapshot } from "../bridge";

/* ------------------------------------------------------------------ *
 * Rows (structural DTOs — mirrored by packages/db/src/repositories;
 * db must not import core, so the shapes are kept structurally equal)
 * ------------------------------------------------------------------ */

export type SubmissionStatus = "draft" | "completed" | "spam";

export type SubmissionRow = {
  id: string;
  workspaceId: string;
  documentId: string;
  versionId: string;
  status: SubmissionStatus;
  publicToken: string;
  variables: Record<string, unknown>;
  hidden: Record<string, unknown>;
  meta: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date | null;
};

export type NewSubmissionRow = Omit<SubmissionRow, "completedAt"> & { completedAt: null };

export type AnswerRow = { blockId: string; value: unknown; updatedAt: Date };

export type AnswerUpsert = { blockId: string; value: unknown; updatedAt: Date };

/** Owned by packages/db (drizzle impl, spec §3 "repositories live in packages/db"). */
export interface SubmissionsRepo {
  insertSubmission(row: NewSubmissionRow): Promise<void>;
  getSubmissionByToken(publicToken: string): Promise<SubmissionRow | null>;
  updateVariables(submissionId: string, variables: Record<string, unknown>): Promise<void>;
  /** Applies each answer only when `updatedAt > answers.updated_at`; returns blockIds actually applied. */
  upsertAnswersIfNewer(submissionId: string, answers: AnswerUpsert[]): Promise<string[]>;
  /** Reconcile upsert — last client value wins (used by complete, spec §10.3). */
  upsertAnswersOverwrite(submissionId: string, answers: AnswerUpsert[]): Promise<void>;
  listAnswers(submissionId: string): Promise<AnswerRow[]>;
  countCompleted(documentId: string): Promise<number>;
  finalizeSubmission(
    submissionId: string,
    patch: { status: SubmissionStatus; completedAt: Date | null; variables: Record<string, unknown> },
  ): Promise<void>;
  transaction<T>(fn: (tx: SubmissionsRepo) => Promise<T>): Promise<T>;
}

/* ------------------------------------------------------------------ *
 * Snapshot / blocks seams
 * ------------------------------------------------------------------ */

export interface SnapshotReader {
  /** Returns the published snapshot or null when the document is missing/unpublished (spec §8/§10.3). */
  getPublishedSnapshot(documentId: string): Promise<Snapshot | null>;
}

/**
 * Structural subset of a Zod schema, so the service stays decoupled from the
 * zod version used by @formforge/blocks.
 */
export type AnswerSchema = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: unknown }
    | { success: false; error: { issues: ReadonlyArray<{ message: string; path: PropertyKey[] }> } };
};

export type BlockFamily = "content" | "question" | "action" | "layout";

export type BlockInfo = {
  kind: string;
  family: BlockFamily;
  /** Question blocks MUST define an answer schema (spec §7.1). */
  answerSchema?: AnswerSchema;
  /** Optional extra server-side validation; returns an error message or null. */
  validate?: (answer: unknown, props: Record<string, unknown>) => string | null;
};

export interface BlockRegistry {
  get(kind: string): BlockInfo | undefined;
}

/* ------------------------------------------------------------------ *
 * Infra seams
 * ------------------------------------------------------------------ */

export type StoredIdempotentResponse = { status: number; body: unknown };

/** Keys are stored for 24h; a repeated key returns the original response (spec §4). */
export interface IdempotencyStore {
  get(key: string): Promise<StoredIdempotentResponse | null>;
  put(key: string, response: StoredIdempotentResponse, ttlSeconds: number): Promise<void>;
}

/** Token-bucket style limiter; `limitPerMinute` grants per rolling minute. */
export interface RateLimiter {
  tryTake(key: string, limitPerMinute: number): Promise<boolean>;
}

/** Cloudflare Turnstile (spec §10.3) — verify only when the document has captcha on. */
export interface TurnstileVerifier {
  verify(token: string | undefined, remoteIp?: string): Promise<boolean>;
}

/** `submission.completed` job payload per spec §12 (fan-out: email, webhooks, analytics). */
export type SubmissionCompletedEvent = {
  id: string;
  type: "submission.completed";
  occurredAt: string;
  workspaceId: string;
  documentId: string;
  data: {
    submissionId: string;
    answers: Record<string, { label?: string; value: unknown }>;
    hidden: Record<string, unknown>;
    variables: Record<string, unknown>;
  };
};

/** Spec §10.3 start rule: "emit start event" (analytics consumer; §12 defines no dedicated job). */
export type SubmissionStartedEvent = {
  id: string;
  type: "submission.started";
  occurredAt: string;
  workspaceId: string;
  documentId: string;
  data: { submissionId: string };
};

export type IngestEvent = SubmissionCompletedEvent | SubmissionStartedEvent;

/** Side effects are enqueued, never executed inline (spec §3). BullMQ `events` queue in prod. */
export interface EventQueue {
  enqueue(event: IngestEvent): Promise<void>;
}

/** Usage counter increments on complete (issue #14). Real counter lands with billing. */
export interface UsageCounter {
  increment(workspaceId: string, key: string, by?: number): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Service deps + request context
 * ------------------------------------------------------------------ */

export type IngestDeps = {
  repo: SubmissionsRepo;
  snapshots: SnapshotReader;
  blocks: BlockRegistry;
  idempotency: IdempotencyStore;
  rateLimiter: RateLimiter;
  turnstile: TurnstileVerifier;
  queue: EventQueue;
  usage: UsageCounter;
  /** Injected clock (spec §4: never `new Date()` inside services). */
  now: () => Date;
  /** UUIDv7 generator (spec §4). */
  generateId: () => string;
  /** Logic engine `evaluate` (spec §9). */
  evaluate: LogicEvaluate;
};

/**
 * SPEC-NOTE: spec §3 wants a full `Ctx` as first service argument, but on the
 * public plane the workspace is only known after the document is resolved.
 * Services build the internal `Ctx` from this request context + the loaded
 * document (actor is `system` — "public" is not an actor type in §3).
 */
export type IngestRequestCtx = {
  requestId: string;
  actor: { type: "system"; id: string };
  now: () => Date;
};

/* ------------------------------------------------------------------ *
 * API inputs/outputs (spec §10.3)
 * ------------------------------------------------------------------ */

export type StartInput = {
  documentId: string;
  hidden?: Record<string, unknown>;
  turnstileToken?: string;
  /** Honeypot `_hp` — must be empty (spec §10.3 Limits). */
  honeypot?: unknown;
  ip?: string;
  meta?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type StartOutput = { token: string; versionId: string };

export type AnswerInput = { blockId: string; value?: unknown; clientTs?: string };

export type SaveInput = {
  token: string;
  answers: AnswerInput[];
  /**
   * SPEC-NOTE: §10.3 shows only `answers` in the save body; the renderer also
   * sends the block it is currently on so the server can compute `next`
   * without guessing. Optional; defaults to the last answered block.
   */
  currentBlockId?: string;
  idempotencyKey?: string;
};

export type SaveOutput = { next: string; variables: Record<string, unknown> };

export type CompleteInput = {
  token: string;
  /** Client's final value for every touched block (spec §10.3). */
  answers: AnswerInput[];
  idempotencyKey?: string;
};

export type CompleteOutput = { endingId: string; redirectUrl: string | null };

/** Field-level validation details (spec §4 error body). */
export type ValidationDetail = { path: string; message: string };
