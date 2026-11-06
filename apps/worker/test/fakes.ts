// In-memory fakes + fake clock for worker job tests (no Redis, no Postgres).
import { createConsoleMailer } from "@formforge/core/integrations";
import { InMemoryObjectStore } from "@formforge/core/assets";
import { createLogger } from "../src/logger";
import type {
  AssetsRepositoryPort,
  AssetRow,
  Clock,
  EnqueueOptions,
  EventRepositoryPort,
  EventRow,
  NewEventRow,
  NewWebhookDelivery,
  NotificationTargetPort,
  QueuePort,
  VirusScannerPort,
  WebhookDeliveryRow,
  WebhookEndpointRow,
  WebhookRepositoryPort,
  WorkerDeps,
} from "../src/ports";
import { JOBS, type JobName, type QueueName } from "../src/queues/names";
import type { HttpPost } from "@formforge/core/integrations";

export function fakeClock(startAt = new Date("2026-11-06T10:00:00.000Z")): Clock & { advanceMs: (ms: number) => void; current: () => Date } {
  let current = startAt.getTime();
  return {
    now: () => new Date(current),
    advanceMs: (ms: number) => {
      current += ms;
    },
    current: () => new Date(current),
  };
}

export type EnqueuedJob = {
  queue: QueueName;
  jobName: JobName | string;
  data: unknown;
  options?: EnqueueOptions;
};

export class FakeQueue implements QueuePort {
  readonly jobs: EnqueuedJob[] = [];
  /** queue+jobName pairs that throw on enqueue (isolation tests). */
  private readonly failing = new Set<string>();
  /** Predicates that throw on enqueue (e.g. one specific webhookId). */
  private readonly failingPredicates: Array<(job: EnqueuedJob) => boolean> = [];

  /**
   * Fail matching by BullMQ job name (e.g. "deliver") OR by deterministic
   * jobId (e.g. webhookDeliverJobId(...) → "wh:<id>:<evt>:a0"). Both keys are
   * checked on enqueue.
   */
  failEnqueue(queue: QueueName, jobNameOrJobId: string): void {
    this.failing.add(`${queue}/${jobNameOrJobId}`);
  }

  failWhen(predicate: (job: EnqueuedJob) => boolean): void {
    this.failingPredicates.push(predicate);
  }

  async enqueue(queue: QueueName, jobName: JobName, data: unknown, options?: EnqueueOptions) {
    const candidate: EnqueuedJob = { queue, jobName, data, options };
    const jobIdKey = options?.jobId !== undefined ? `${queue}/${options.jobId}` : null;
    if (
      this.failing.has(`${queue}/${String(jobName)}`) ||
      (jobIdKey !== null && this.failing.has(jobIdKey)) ||
      this.failingPredicates.some((p) => p(candidate))
    ) {
      throw new Error(`enqueue failed for ${queue}/${String(jobName)}`);
    }
    this.jobs.push(candidate);
    return { jobId: options?.jobId ?? null };
  }

  jobsFor(queue: QueueName, jobName?: string): EnqueuedJob[] {
    return this.jobs.filter((job) => job.queue === queue && (jobName === undefined || job.jobName === jobName));
  }
}

export class FakeEventRepository implements EventRepositoryPort {
  readonly rows = new Map<string, EventRow>();
  insertCalls = 0;

  async insertEventOnce(row: NewEventRow): Promise<{ created: boolean }> {
    this.insertCalls += 1;
    if (this.rows.has(row.id)) return { created: false };
    this.rows.set(row.id, { ...row, processedAt: null });
    return { created: true };
  }

  async getEvent(id: string): Promise<EventRow | null> {
    return this.rows.get(id) ?? null;
  }

  async markEventProcessed(id: string, processedAt: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.processedAt = processedAt;
  }
}

export class FakeWebhookRepository implements WebhookRepositoryPort {
  readonly endpoints = new Map<string, WebhookEndpointRow>();
  /** Insertion order = recency order (fake clock is frozen). */
  readonly deliveries: WebhookDeliveryRow[] = [];
  disabledCalls = 0;
  private deliverySeq = 0;

  seedEndpoint(endpoint: WebhookEndpointRow): void {
    this.endpoints.set(endpoint.id, endpoint);
  }

  async seedDeliveries(webhookId: string, outcomes: boolean[]): Promise<void> {
    for (const ok of outcomes) {
      await this.recordDelivery({
        id: `seed-${webhookId}-${this.deliverySeq}`,
        webhookId,
        eventId: "seed-event",
        attempt: 0,
        statusCode: ok ? 200 : 500,
        ok,
        durationMs: 10,
        error: ok ? null : "http 500",
      });
    }
  }

  async recordDelivery(delivery: NewWebhookDelivery): Promise<WebhookDeliveryRow | null> {
    if (this.deliveries.some((row) => row.id === delivery.id)) return null;
    const row: WebhookDeliveryRow = { ...delivery, createdAt: new Date(1_700_000_000_000 + this.deliverySeq) };
    this.deliverySeq += 1;
    this.deliveries.push(row);
    return row;
  }

  async getDelivery(id: string): Promise<WebhookDeliveryRow | null> {
    return this.deliveries.find((row) => row.id === id) ?? null;
  }

  async listDeliveries(webhookId: string, limit = 50): Promise<WebhookDeliveryRow[]> {
    return [...this.deliveries]
      .reverse()
      .filter((row) => row.webhookId === webhookId)
      .slice(0, limit);
  }

  async getRecentAttempts(webhookId: string): Promise<Array<{ ok: boolean }>> {
    return (await this.listDeliveries(webhookId, 10)).map((row) => ({ ok: row.ok }));
  }

  async countConsecutiveFailures(webhookId: string): Promise<number> {
    const attempts = await this.getRecentAttempts(webhookId);
    let count = 0;
    for (const attempt of attempts) {
      if (attempt.ok) break;
      count += 1;
    }
    return count;
  }

  async disableEndpoint(id: string): Promise<boolean> {
    this.disabledCalls += 1;
    const endpoint = this.endpoints.get(id);
    if (!endpoint || !endpoint.enabled) return false;
    endpoint.enabled = false;
    return true;
  }

  async getEndpoint(id: string): Promise<WebhookEndpointRow | null> {
    return this.endpoints.get(id) ?? null;
  }

  async listActiveEndpoints(args: { workspaceId: string; documentId: string; eventType: string }) {
    return [...this.endpoints.values()].filter(
      (endpoint) =>
        endpoint.workspaceId === args.workspaceId &&
        endpoint.enabled &&
        endpoint.events.includes(args.eventType) &&
        (endpoint.documentId === null || endpoint.documentId === args.documentId),
    );
  }
}

export class FakeNotifications implements NotificationTargetPort {
  constructor(private readonly target: { email: string; documentTitle: string | null } | null) {}

  async getEventNotificationTarget() {
    return this.target;
  }
}

export type CapturedRequest = { url: string; headers: Record<string, string>; body: string };

export function fakePost(responses: Array<{ ok: boolean; status: number }> = []): {
  post: HttpPost;
  requests: CapturedRequest[];
  setNext: (response: { ok: boolean; status: number }) => void;
} {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];
  let next: { ok: boolean; status: number } = { ok: true, status: 200 };
  return {
    requests,
    setNext: (response) => {
      next = response;
    },
    post: async (url, init) => {
      requests.push({
        url,
        headers: init.headers,
        body: init.body,
      });
      const response = queue.length > 0 ? (queue.shift() as { ok: boolean; status: number }) : next;
      return response;
    },
  };
}

/** T16 — in-memory assets repository + verdict-controllable scanner. */
export class FakeAssetsRepository implements AssetsRepositoryPort {
  readonly rows = new Map<string, AssetRow>();
  readonly removedIds: string[] = [];

  seed(row: AssetRow): void {
    this.rows.set(row.id, row);
  }

  async getByIdUnscoped(assetId: string): Promise<AssetRow | null> {
    return this.rows.get(assetId) ?? null;
  }

  async patch(
    assetId: string,
    patch: Partial<Pick<AssetRow, "scanStatus" | "variants" | "mime">>,
  ): Promise<AssetRow | null> {
    const row = this.rows.get(assetId);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }
}

export class FakeScanner implements VirusScannerPort {
  constructor(public verdict: "clean" | "infected" | "unavailable" = "clean") {}
  readonly scannedKeys: string[] = [];
  async scan(input: { key: string }): Promise<"clean" | "infected" | "unavailable"> {
    this.scannedKeys.push(input.key);
    return this.verdict;
  }
}

export type TestHarness = {
  deps: WorkerDeps;
  clock: ReturnType<typeof fakeClock>;
  queue: FakeQueue;
  events: FakeEventRepository;
  webhooks: FakeWebhookRepository;
  post: ReturnType<typeof fakePost>;
  logs: string[];
  /** T16 — the default in-memory assets repo (unless overridden via makeDeps). */
  assets: AssetsRepositoryPort;
  store: WorkerDeps["store"];
  scanner: VirusScannerPort;
};

export function makeDeps(overrides: {
  notificationTarget?: { email: string; documentTitle: string | null } | null;
  appUrl?: string;
  scanner?: VirusScannerPort;
  assets?: AssetsRepositoryPort;
} = {}): TestHarness {
  const clock = fakeClock();
  const queue = new FakeQueue();
  const events = new FakeEventRepository();
  const webhooks = new FakeWebhookRepository();
  const post = fakePost();
  const logs: string[] = [];
  const logger = createLogger({ service: "worker-test" }, { sink: (line) => logs.push(line) });
  const deps: WorkerDeps = {
    clock,
    logger,
    queue,
    events,
    webhooks,
    assets: overrides.assets ?? new FakeAssetsRepository(),
    store: new InMemoryObjectStore({ now: clock.now }),
    scanner: overrides.scanner ?? new FakeScanner("unavailable"),
    notifications: new FakeNotifications(
      overrides.notificationTarget === undefined
        ? { email: "owner@example.com", documentTitle: "Contact form" }
        : overrides.notificationTarget,
    ),
    mailer: createConsoleMailer({ log: (line) => logs.push(line) }),
    post: post.post,
    jitter: () => 0,
    newId: (() => {
      let n = 0;
      return () => `dl-${(n += 1)}`;
    })(),
    appUrl: overrides.appUrl ?? "http://localhost:3000",
  };
  const harness: TestHarness = {
    deps,
    clock,
    queue,
    events,
    webhooks,
    post,
    logs,
    assets: deps.assets,
    store: deps.store,
    scanner: deps.scanner,
  };
  return harness;
}

// Re-export for convenience in tests.
export { JOBS };
