// packages/core/src/submissions/ingest.ts
// Public ingest service (spec §10.3, issue #14): start / save / complete with
// idempotency, honeypot, rate limits, per-answer validation against the
// published snapshot, logic-driven `next` and the `submission.completed` event.

import {
  AppError,
  parseDocumentId,
  parseIsoDate,
  shortId,
  type ErrorDetail,
  type Result,
  type Snapshot,
} from "../bridge";
import {
  buildQuestionIndex,
  firstQuestionBlockId,
  isEmptyAnswer,
  isRequired,
  validateAnswers,
  type ParsedAnswer,
} from "./blocks";
import type {
  AnswerUpsert,
  CompleteInput,
  CompleteOutput,
  IngestDeps,
  IngestRequestCtx,
  NewSubmissionRow,
  SaveInput,
  SaveOutput,
  StartInput,
  StartOutput,
  SubmissionRow,
  ValidationDetail,
} from "./types";

export const START_RATE_LIMIT_PER_MINUTE = 60; // per-IP (spec §10.3 Limits)
export const SAVE_RATE_LIMIT_PER_MINUTE = 120; // per-token (spec §10.3 Limits)
export const MAX_PAYLOAD_BYTES = 256 * 1024; // payload cap (spec §10.3 Limits)
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h (spec §4)

/** Pure helper so the payload cap is testable outside the HTTP layer. */
export function payloadSizeError(byteLength: number): AppError | null {
  if (byteLength <= MAX_PAYLOAD_BYTES) return null;
  // SPEC-NOTE: §4 has no dedicated 413 code; the payload cap is surfaced as
  // VALIDATION (mapped to 422) with the spec error shape.
  return new AppError("VALIDATION", "Payload too large", [
    { path: "body", message: `Payload exceeds ${MAX_PAYLOAD_BYTES} bytes` },
  ]);
}

function filledHoneypot(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

/**
 * Idempotency wrapper (spec §4): a repeated `Idempotency-Key` replays the
 * stored response body. Only successful (ok) results are stored — a failed
 * attempt retried with the same key re-executes.
 */
async function withIdempotency<T>(
  deps: IngestDeps,
  key: string | undefined,
  compute: () => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  if (!key) return compute();
  const stored = await deps.idempotency.get(key);
  if (stored) return { ok: true, value: stored.body as T };
  const result = await compute();
  if (result.ok) {
    await deps.idempotency.put(key, { status: 200, body: result.value }, IDEMPOTENCY_TTL_SECONDS);
  }
  return result;
}

function toUpserts(
  parsed: ParsedAnswer[],
  fallbackTs: Date,
): { upserts: AnswerUpsert[]; details: ValidationDetail[] } {
  const upserts: AnswerUpsert[] = [];
  const details: ValidationDetail[] = [];
  for (const [i, answer] of parsed.entries()) {
    if (answer.clientTs !== undefined) {
      const ts = parseIsoDate(answer.clientTs);
      if (!ts) {
        details.push({ path: `answers[${i}].clientTs`, message: "clientTs must be an ISO datetime" });
        continue;
      }
      upserts.push({ blockId: answer.blockId, value: answer.value, updatedAt: ts });
    } else {
      upserts.push({ blockId: answer.blockId, value: answer.value, updatedAt: fallbackTs });
    }
  }
  return { upserts, details };
}

function answersMap(rows: { blockId: string; value: unknown }[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows) map[row.blockId] = row.value;
  return map;
}

/* ------------------------------------------------------------------ *
 * Start — POST /api/public/ingest/submissions (spec §10.1/§10.3)
 * ------------------------------------------------------------------ */

export async function startSubmission(
  deps: IngestDeps,
  _request: IngestRequestCtx,
  input: StartInput,
): Promise<Result<StartOutput, AppError>> {
  // Honeypot first: bots get a plausible response and nothing is stored.
  // SPEC-NOTE: issue #14 says "silently mark spam"; ticket instructions say
  // "silent success / no store". We follow the ticket (no bot rows in the DB)
  // and return a synthetic token that will 404 on save/complete.
  if (filledHoneypot(input.honeypot)) {
    return { ok: true, value: { token: shortId("sub", deps.generateId()), versionId: "00000000-0000-0000-0000-000000000000" } };
  }

  const allowed = await deps.rateLimiter.tryTake(
    `ingest:start:ip:${input.ip ?? "unknown"}`,
    START_RATE_LIMIT_PER_MINUTE,
  );
  if (!allowed) {
    return { ok: false, error: new AppError("RATE_LIMITED", "Too many requests, slow down.") };
  }

  if (typeof input.documentId !== "string" || input.documentId === "") {
    return {
      ok: false,
      error: new AppError("VALIDATION", "Invalid input", [
        { path: "documentId", message: "documentId is required" },
      ]),
    };
  }

  return withIdempotency(deps, input.idempotencyKey, async () => {
    const documentId = parseDocumentId(input.documentId);
    if (!documentId) {
      return {
        ok: false,
        error: new AppError("VALIDATION", "Invalid input", [
          { path: "documentId", message: "documentId must be a doc_ short id or uuid" },
        ]),
      };
    }
    const snapshot = await deps.snapshots.getPublishedSnapshot(documentId);
    if (!snapshot) {
      // Published-only access: missing/archived/unpublished all 404 (§10.3).
      return { ok: false, error: new AppError("NOT_FOUND", "Document not found.") };
    }
    const now = deps.now();
    if (snapshot.settings.closeAt) {
      const closeAt = parseIsoDate(snapshot.settings.closeAt);
      if (closeAt && now.getTime() > closeAt.getTime()) {
        // SPEC-NOTE: no code is pinned for "closed for submissions" in §4;
        // FORBIDDEN (403) keeps the error shape while signaling availability.
        return {
          ok: false,
          error: new AppError("FORBIDDEN", "This form is no longer accepting responses."),
        };
      }
    }
    if (snapshot.settings.maxSubmissions != null) {
      const completed = await deps.repo.countCompleted(snapshot.documentId);
      if (completed >= snapshot.settings.maxSubmissions) {
        return {
          ok: false,
          error: new AppError("FORBIDDEN", "This form has reached its submission limit."),
        };
      }
    }
    if (snapshot.settings.captcha) {
      const human = await deps.turnstile.verify(input.turnstileToken, input.ip);
      if (!human) {
        return {
          ok: false,
          error: new AppError("FORBIDDEN", "Captcha verification failed."),
        };
      }
    }

    const id = deps.generateId();
    const row: NewSubmissionRow = {
      id,
      workspaceId: snapshot.workspaceId,
      documentId: snapshot.documentId,
      versionId: snapshot.versionId,
      status: "draft",
      publicToken: shortId("sub", id),
      variables: {},
      hidden: input.hidden ?? {},
      meta: input.meta ?? {},
      startedAt: now,
      completedAt: null,
    };
    await deps.repo.insertSubmission(row);

    await deps.queue.enqueue({
      id: shortId("evt", deps.generateId()),
      type: "submission.started",
      occurredAt: now.toISOString(),
      workspaceId: snapshot.workspaceId,
      documentId: snapshot.documentId,
      data: { submissionId: id },
    });

    return { ok: true, value: { token: row.publicToken, versionId: snapshot.versionId } };
  });
}

/* ------------------------------------------------------------------ *
 * Save step — PATCH /api/public/ingest/submissions/:token (spec §10.3)
 * ------------------------------------------------------------------ */

export async function saveStep(
  deps: IngestDeps,
  _request: IngestRequestCtx,
  input: SaveInput,
): Promise<Result<SaveOutput, AppError>> {
  const allowed = await deps.rateLimiter.tryTake(
    `ingest:save:token:${input.token}`,
    SAVE_RATE_LIMIT_PER_MINUTE,
  );
  if (!allowed) {
    return { ok: false, error: new AppError("RATE_LIMITED", "Too many requests, slow down.") };
  }

  return withIdempotency(deps, input.idempotencyKey, async () => {
    const submission = await deps.repo.getSubmissionByToken(input.token);
    if (!submission) return { ok: false, error: new AppError("NOT_FOUND", "Submission not found.") };
    // Draft submissions only while status=draft (issue #14).
    if (submission.status !== "draft") {
      return {
        ok: false,
        error: new AppError("CONFLICT", "Submission is no longer editable."),
      };
    }
    const snapshot = await loadSnapshot(deps, submission);
    if (!snapshot) return { ok: false, error: new AppError("NOT_FOUND", "Document not found.") };

    const validation = validateAnswers(snapshot, deps.blocks, input.answers);
    if (!validation.ok) {
      return { ok: false, error: new AppError("VALIDATION", "Invalid input", validation.error) };
    }
    const now = deps.now();
    const { upserts, details } = toUpserts(validation.parsed, now);
    if (details.length > 0) {
      return { ok: false, error: new AppError("VALIDATION", "Invalid input", details) };
    }

    // Upsert per answer only if clientTs > answers.updated_at (§10.3): the
    // service filters stale answers, the repo enforces the same rule
    // atomically as a second guard against concurrent saves.
    const existing = await deps.repo.listAnswers(submission.id);
    const existingMap = new Map(existing.map((row) => [row.blockId, row]));
    const newer = upserts.filter((upsert) => {
      const prev = existingMap.get(upsert.blockId);
      return !prev || upsert.updatedAt.getTime() > prev.updatedAt.getTime();
    });
    const applied = await deps.repo.upsertAnswersIfNewer(submission.id, newer);
    const appliedSet = new Set(applied);

    const merged = answersMap(existing);
    for (const upsert of newer) {
      if (appliedSet.has(upsert.blockId)) merged[upsert.blockId] = upsert.value;
    }

    const currentIndex =
      input.currentBlockId ??
      newer.at(-1)?.blockId ??
      firstQuestionBlockId(snapshot, deps.blocks) ??
      "";
    const evaluated = deps.evaluate(snapshot.routing, {
      answers: merged,
      variables: submission.variables,
      hidden: submission.hidden,
      currentBlockId: currentIndex,
    });
    await deps.repo.updateVariables(submission.id, evaluated.variables);

    return { ok: true, value: { next: evaluated.nextBlockId, variables: evaluated.variables } };
  });
}

/* ------------------------------------------------------------------ *
 * Complete — POST /api/public/ingest/submissions/:token/complete (§10.3)
 * ------------------------------------------------------------------ */

export async function completeSubmission(
  deps: IngestDeps,
  _request: IngestRequestCtx,
  input: CompleteInput,
): Promise<Result<CompleteOutput, AppError>> {
  return withIdempotency(deps, input.idempotencyKey, async () => {
    const submission = await deps.repo.getSubmissionByToken(input.token);
    if (!submission) return { ok: false, error: new AppError("NOT_FOUND", "Submission not found.") };
    // Idempotent replay goes through the Idempotency-Key store above; a bare
    // second call on a finalized submission is a CONFLICT (issue #14).
    if (submission.status === "completed") {
      return { ok: false, error: new AppError("CONFLICT", "Submission already completed.") };
    }
    if (submission.status === "spam") {
      return { ok: false, error: new AppError("CONFLICT", "Submission cannot be completed.") };
    }
    const snapshot = await loadSnapshot(deps, submission);
    if (!snapshot) return { ok: false, error: new AppError("NOT_FOUND", "Document not found.") };

    const validation = validateAnswers(snapshot, deps.blocks, input.answers);
    if (!validation.ok) {
      return { ok: false, error: new AppError("VALIDATION", "Invalid input", validation.error) };
    }
    const now = deps.now();
    const { upserts, details } = toUpserts(validation.parsed, now);
    if (details.length > 0) {
      return { ok: false, error: new AppError("VALIDATION", "Invalid input", details) };
    }

    // Reconcile: last client value wins (§10.3) — unconditional upserts.
    const existing = await deps.repo.listAnswers(submission.id);
    const merged = answersMap(existing);
    for (const upsert of upserts) merged[upsert.blockId] = upsert.value;

    // Walk the logic path with the merged answers and validate required
    // question blocks the path reaches (§10.3).
    const walk = simulateLogicPath(deps, snapshot, merged, submission);
    if (!walk.ok) return walk;

    await deps.repo.transaction(async (tx) => {
      await tx.upsertAnswersOverwrite(submission.id, upserts);
      await tx.finalizeSubmission(submission.id, {
        status: "completed",
        completedAt: now,
        variables: walk.variables,
      });
    });

    const questionIndex = buildQuestionIndex(snapshot, deps.blocks);
    const eventAnswers: Record<string, { label?: string; value: unknown }> = {};
    for (const [blockId, value] of Object.entries(merged)) {
      const question = questionIndex.get(blockId);
      if (!question) continue;
      const label = question.props.label;
      eventAnswers[blockId] = {
        label: typeof label === "string" ? label : undefined,
        value,
      };
    }
    await deps.queue.enqueue({
      id: shortId("evt", deps.generateId()),
      type: "submission.completed",
      occurredAt: now.toISOString(),
      workspaceId: submission.workspaceId,
      documentId: submission.documentId,
      data: {
        submissionId: submission.id,
        answers: eventAnswers,
        hidden: submission.hidden,
        variables: walk.variables,
      },
    });

    // Usage counter increments on complete (issue #14).
    await deps.usage.increment(submission.workspaceId, "submissions.completed", 1);

    const ending = snapshot.endings.find((e) => e.id === walk.endingId);
    return {
      ok: true,
      value: { endingId: walk.endingId, redirectUrl: ending?.redirectUrl ?? null },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Logic-path simulation (required blocks on the path, §10.3)
 * ------------------------------------------------------------------ */

type WalkResult =
  | { ok: true; endingId: string; variables: Record<string, unknown> }
  | { ok: false; error: AppError };

function simulateLogicPath(
  deps: IngestDeps,
  snapshot: Snapshot,
  answers: Record<string, unknown>,
  submission: SubmissionRow,
): WalkResult {
  const questionIndex = buildQuestionIndex(snapshot, deps.blocks);
  const missing: ErrorDetail[] = [];
  const visited = new Set<string>();
  let variables = { ...submission.variables };

  let current: string | null = firstQuestionBlockId(snapshot, deps.blocks);
  let terminal: string | null = null;
  const maxSteps = questionIndex.size + 2;

  while (current && !current.startsWith("end:") && !visited.has(current) && visited.size < maxSteps) {
    visited.add(current);
    const question = questionIndex.get(current);
    if (question && isRequired(question.props) && isEmptyAnswer(answers[current])) {
      missing.push({ path: `answers.${current}`, message: "This question is required" });
    }
    const evaluated = deps.evaluate(snapshot.routing, {
      answers,
      variables,
      hidden: submission.hidden,
      currentBlockId: current,
    });
    variables = evaluated.variables;
    current = evaluated.nextBlockId;
  }
  if (current?.startsWith("end:")) terminal = current.slice("end:".length);

  const endingId =
    terminal && snapshot.endings.some((e) => e.id === terminal)
      ? terminal
      : (snapshot.endings[0]?.id ?? "default");

  if (missing.length > 0) {
    return {
      ok: false,
      error: new AppError("VALIDATION", "Some required questions are unanswered", missing),
    };
  }
  return { ok: true, endingId, variables };
}

async function loadSnapshot(
  deps: IngestDeps,
  submission: SubmissionRow,
): Promise<Snapshot | null> {
  return deps.snapshots.getPublishedSnapshot(submission.documentId);
}
