// packages/core/src/submissions/memory.ts
// In-memory implementations of the ingest seams. Used by the vitest suite and
// as dev fallbacks in apps/web when REDIS_URL / DATABASE_URL are absent.

import type {
  AnswerRow,
  AnswerUpsert,
  IdempotencyStore,
  IngestEvent,
  NewSubmissionRow,
  RateLimiter,
  StoredIdempotentResponse,
  SubmissionRow,
  SubmissionsRepo,
  TurnstileVerifier,
  UsageCounter,
} from "./types";

export class InMemorySubmissionsRepo implements SubmissionsRepo {
  private rows = new Map<string, SubmissionRow>();
  private tokenIndex = new Map<string, string>();
  private answers = new Map<string, Map<string, AnswerRow>>();

  async insertSubmission(row: NewSubmissionRow): Promise<void> {
    const copy: SubmissionRow = { ...row, variables: { ...row.variables }, hidden: { ...row.hidden }, meta: { ...row.meta } };
    this.rows.set(copy.id, copy);
    this.tokenIndex.set(copy.publicToken, copy.id);
  }

  async getSubmissionByToken(publicToken: string): Promise<SubmissionRow | null> {
    const id = this.tokenIndex.get(publicToken);
    if (!id) return null;
    const row = this.rows.get(id);
    return row ? this.clone(row) : null;
  }

  async updateVariables(submissionId: string, variables: Record<string, unknown>): Promise<void> {
    const row = this.rows.get(submissionId);
    if (row) row.variables = { ...variables };
  }

  async upsertAnswersIfNewer(submissionId: string, answers: AnswerUpsert[]): Promise<string[]> {
    const map = this.answerMap(submissionId);
    const applied: string[] = [];
    for (const upsert of answers) {
      const prev = map.get(upsert.blockId);
      if (prev && prev.updatedAt.getTime() >= upsert.updatedAt.getTime()) continue;
      map.set(upsert.blockId, { ...upsert });
      applied.push(upsert.blockId);
    }
    return applied;
  }

  async upsertAnswersOverwrite(submissionId: string, answers: AnswerUpsert[]): Promise<void> {
    const map = this.answerMap(submissionId);
    for (const upsert of answers) map.set(upsert.blockId, { ...upsert });
  }

  async listAnswers(submissionId: string): Promise<AnswerRow[]> {
    return [...(this.answers.get(submissionId)?.values() ?? [])]
      .map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }))
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  }

  async countCompleted(documentId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.documentId === documentId && row.status === "completed") count += 1;
    }
    return count;
  }

  async finalizeSubmission(
    submissionId: string,
    patch: { status: SubmissionRow["status"]; completedAt: Date | null; variables: Record<string, unknown> },
  ): Promise<void> {
    const row = this.rows.get(submissionId);
    if (!row) return;
    row.status = patch.status;
    row.completedAt = patch.completedAt;
    row.variables = { ...patch.variables };
  }

  async transaction<T>(fn: (tx: SubmissionsRepo) => Promise<T>): Promise<T> {
    // Single in-memory store — no isolation needed.
    return fn(this);
  }

  /** Test helper: number of stored submissions. */
  get size(): number {
    return this.rows.size;
  }

  private answerMap(submissionId: string): Map<string, AnswerRow> {
    let map = this.answers.get(submissionId);
    if (!map) {
      map = new Map();
      this.answers.set(submissionId, map);
    }
    return map;
  }

  private clone(row: SubmissionRow): SubmissionRow {
    return {
      ...row,
      variables: { ...row.variables },
      hidden: { ...row.hidden },
      meta: { ...row.meta },
      startedAt: new Date(row.startedAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
    };
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private entries = new Map<string, { response: StoredIdempotentResponse; expiresAt: number }>();

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async get(key: string): Promise<StoredIdempotentResponse | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.nowMs()) {
      this.entries.delete(key);
      return null;
    }
    return { ...entry.response, body: structuredClone(entry.response.body) };
  }

  async put(key: string, response: StoredIdempotentResponse, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      response: { ...response, body: structuredClone(response.body) },
      expiresAt: this.nowMs() + ttlSeconds * 1000,
    });
  }
}

/** Token bucket: capacity = limitPerMinute, refill limitPerMinute/60 per second. */
export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { tokens: number; lastMs: number }>();

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async tryTake(key: string, limitPerMinute: number): Promise<boolean> {
    const now = this.nowMs();
    const refillPerMs = limitPerMinute / 60_000;
    const bucket = this.buckets.get(key) ?? { tokens: limitPerMinute, lastMs: now };
    bucket.tokens = Math.min(limitPerMinute, bucket.tokens + (now - bucket.lastMs) * refillPerMs);
    bucket.lastMs = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }
}

export class StubTurnstileVerifier implements TurnstileVerifier {
  constructor(private readonly accept: boolean | ((token: string | undefined) => boolean) = true) {}

  async verify(token: string | undefined): Promise<boolean> {
    if (typeof this.accept === "function") return this.accept(token);
    return this.accept;
  }
}

/** Captures enqueued events for assertions (queue consumer is stubbed until later tickets). */
export class CaptureEventQueue {
  readonly events: IngestEvent[] = [];

  async enqueue(event: IngestEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  byType<T extends IngestEvent["type"]>(type: T): Extract<IngestEvent, { type: T }>[] {
    return this.events.filter((e): e is Extract<IngestEvent, { type: T }> => e.type === type);
  }
}

export class InMemoryUsageCounter implements UsageCounter {
  readonly counts = new Map<string, number>();

  async increment(workspaceId: string, key: string, by = 1): Promise<void> {
    const composite = `${workspaceId}:${key}`;
    this.counts.set(composite, (this.counts.get(composite) ?? 0) + by);
  }
}
