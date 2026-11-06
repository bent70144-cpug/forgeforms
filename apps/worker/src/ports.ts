// Worker ports — the ONLY place worker business logic touches the outside
// world. Everything is injectable so jobs run under vitest with in-memory
// fakes + a fake clock (Redis/Postgres are unavailable in the sandbox; the
// BullMQ wiring stays thin in src/index.ts + src/queues/bullmq-queue-port.ts).
//
// INTEGRATION-DEBT: awaiting T02 — the row DTOs below are structurally
// identical to the ones in packages/db/src/repositories/{events,webhooks}.ts
// (which own the SQL). When T02 lands, wire the real repositories here — the
// shapes already match, so the swap is mechanical.
import type { AppError, Ctx, Result } from "@formforge/core/bridge";
import type { DeliveryOutcome, HttpPost, Mailer, SubmissionCompletedEvent } from "@formforge/core/integrations";
import type { ObjectStore } from "@formforge/core/assets";
import type { GdprStoresPort } from "./jobs/retention-purge";
import type { JobName, QueueName } from "./queues/names";
import type { Logger } from "./logger";

export type { AppError, Ctx, Result, Logger };

// ---------------------------------------------------------------------------
// Row DTOs (mirror of packages/db repository row types)
// ---------------------------------------------------------------------------

export type EventRow = {
  id: string;
  workspaceId: string;
  type: string;
  documentId: string | null;
  payload: unknown;
  occurredAt: Date;
  processedAt: Date | null;
};

export type NewEventRow = Omit<EventRow, "processedAt">;

export type WebhookEndpointRow = {
  id: string;
  workspaceId: string;
  documentId: string | null;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdAt: Date;
};

export type WebhookDeliveryRow = {
  id: string;
  webhookId: string;
  eventId: string;
  attempt: number;
  statusCode: number | null;
  ok: boolean;
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
};

export type NewWebhookDelivery = Omit<WebhookDeliveryRow, "createdAt">;

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

export type EventRepositoryPort = {
  insertEventOnce(row: NewEventRow): Promise<{ created: boolean }>;
  getEvent(id: string): Promise<EventRow | null>;
  markEventProcessed(id: string, processedAt: Date): Promise<void>;
};

export type WebhookRepositoryPort = {
  listActiveEndpoints(args: {
    workspaceId: string;
    documentId: string;
    eventType: string;
  }): Promise<WebhookEndpointRow[]>;
  getEndpoint(id: string): Promise<WebhookEndpointRow | null>;
  recordDelivery(delivery: NewWebhookDelivery): Promise<WebhookDeliveryRow | null>;
  getDelivery(id: string): Promise<WebhookDeliveryRow | null>;
  listDeliveries(webhookId: string, limit?: number): Promise<WebhookDeliveryRow[]>;
  getRecentAttempts(webhookId: string): Promise<Array<{ ok: boolean }>>;
  countConsecutiveFailures(webhookId: string): Promise<number>;
  disableEndpoint(id: string): Promise<boolean>;
};

/** Directory lookups for notification targets (owner email + document title). */
export type NotificationTargetPort = {
  getEventNotificationTarget(args: {
    workspaceId: string;
    documentId: string;
  }): Promise<{ email: string; documentTitle: string | null } | null>;
};

// ---------------------------------------------------------------------------
// T16 assets ports (spec §12 assets queue: scan + process-image)
// ---------------------------------------------------------------------------

/** Structural mirror of the assets row (packages/db repositories/assets.ts). */
export type AssetRow = {
  id: string;
  workspaceId: string;
  key: string;
  mime: string;
  sizeBytes: number;
  purpose: string;
  scanStatus: "pending" | "clean" | "infected" | "skipped";
  variants: unknown;
  confirmedAt: Date | null;
  createdAt: Date;
};

/**
 * System-plane asset persistence for job handlers (the worker is not
 * request-scoped; statements key by id like the other system-plane repos).
 */
export type AssetsRepositoryPort = {
  getByIdUnscoped(assetId: string): Promise<AssetRow | null>;
  patch(
    assetId: string,
    patch: Partial<Pick<AssetRow, "scanStatus" | "variants" | "mime">>,
  ): Promise<AssetRow | null>;
};

/** Virus scanner seam (spec §12: ClamAV, or `unavailable` → skipped in dev). */
export type VirusScannerPort = {
  scan(input: { key: string }): Promise<"clean" | "infected" | "unavailable">;
};

// ---------------------------------------------------------------------------
// Queue + runtime ports
// ---------------------------------------------------------------------------

export type EnqueueOptions = {
  /** Deterministic job id — powers at-most-once side effects across retries. */
  jobId?: string;
  /** Delay before the job becomes runnable (ms) — the webhook backoff schedule. */
  delayMs?: number;
};

export type EnqueueResult = { jobId: string | null };

export type QueuePort = {
  enqueue(
    queue: QueueName,
    jobName: JobName,
    data: unknown,
    options?: EnqueueOptions,
  ): Promise<EnqueueResult>;
};

export type Clock = { now: () => Date };

/** Injectable id factory (uuid now; uuidv7 from the T02 kernel later). */
export type IdFactory = () => string;

/** Everything a job processor needs; built once in src/index.ts, faked in tests. */
export type WorkerDeps = {
  clock: Clock;
  logger: Logger;
  queue: QueuePort;
  events: EventRepositoryPort;
  webhooks: WebhookRepositoryPort;
  notifications: NotificationTargetPort;
  /** T16 — asset rows for the `assets` queue handlers (scan / process-image). */
  assets: AssetsRepositoryPort;
  /** T16 — object storage (readRange for dimension sniffing, remove for purge). */
  store: ObjectStore;
  /** T16 — AV seam; the dev default reports "unavailable" → `skipped` (§12). */
  scanner: VirusScannerPort;
  mailer: Mailer;
  /** HTTP transport for webhook deliveries (injectable for tests). */
  post: HttpPost;
  /**
   * T29 (spec §17 GDPR) — GDPR store bundle for the retention/workspace purge
   * job. Constructed over the DB when DATABASE_URL is set (see src/index.ts);
   * omitted in dev/test → the job fails loudly instead of silently purging
   * nothing (same posture as the T02 repository stubs).
   */
  gdpr?: GdprStoresPort;
  /** Jitter source for the backoff schedule (injectable for tests). */
  jitter: () => number;
  newId: IdFactory;
  webhookTimeoutMs?: number;
  /** Absolute app URL used to build results links in notification emails. */
  appUrl: string;
  /**
   * Optional analytics seam for the fan-out (issue #17 lists an analytics
   * hook; spec §12 routes analytics via beacons/cron — T19 decides). Isolated:
   * failures are logged and never block the fan-out.
   */
  analyticsHook?: (event: SubmissionCompletedEvent) => Promise<void>;
};

/** Build a spec §3 Ctx for a background job (system actor, injected clock). */
export function systemCtx(args: { workspaceId: string; requestId: string; clock: Clock }): Ctx {
  return {
    workspaceId: args.workspaceId,
    actor: { type: "system", id: "worker" },
    requestId: args.requestId,
    now: args.clock.now,
  };
}

export type { DeliveryOutcome };
