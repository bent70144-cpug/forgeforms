// FormForge worker entrypoint (T17, issue #17) — thin BullMQ wiring only.
//
// All business logic lives in src/jobs/** behind injectable ports (src/ports.ts)
// so it is unit-tested with fakes + a fake clock (Redis/Postgres are not
// available in CI sandboxes). This file: env → deps → queues → workers →
// graceful shutdown.
//
// INTEGRATION-DEBT: awaiting T02 — the drizzle client + `events` /
// `webhook_endpoints` tables are not merged yet, so the DB-backed repositories
// from packages/db/src/repositories/** cannot be constructed here. The stubs
// below fail loudly (every job errors) instead of silently no-opping; swap them
// for createEventsRepository(queryFn) / createWebhooksRepository(queryFn) with
// the T02 client. Queue topology, job contracts and processors are final.
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { Pool } from "pg";
import { objectStoreFromEnv } from "@formforge/core/assets";
import { createConsoleMailer, createResendMailer, createSsrfSafePost } from "@formforge/core/integrations";
import {
  createGdprRetentionStore,
  createGdprWorkspaceStore,
} from "@formforge/db/repositories/gdpr";
import { loadWorkerConfig } from "./config";
import { createLogger } from "./logger";
import type { EventRepositoryPort, WebhookRepositoryPort, WorkerDeps } from "./ports";
import { createBullQueuePort, QUEUE_DEFAULT_JOB_OPTIONS } from "./queues/bullmq-queue-port";
import { QUEUES } from "./queues/names";
import { registerJobs } from "./jobs/registry";

const config = loadWorkerConfig();
const logger = createLogger({ service: "formforge-worker" }, { level: config.logLevel });

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

// --- Mailer: Resend when configured, console (dev transport) otherwise -------
const mailer = config.resendApiKey
  ? createResendMailer({ apiKey: config.resendApiKey, from: config.mailFrom })
  : createConsoleMailer();

// --- Repositories: UNWIRED until T02 lands (see header INTEGRATION-DEBT) -----
function unwired(method: string): () => Promise<never> {
  return async () => {
    throw new Error(
      `db not wired: ${method} requires the T02 drizzle client (INTEGRATION-DEBT — wire packages/db repositories in src/index.ts)`,
    );
  };
}

const eventsRepository: EventRepositoryPort = {
  insertEventOnce: unwired("events.insertEventOnce"),
  getEvent: unwired("events.getEvent"),
  markEventProcessed: unwired("events.markEventProcessed"),
};

const webhooksRepository: WebhookRepositoryPort = {
  listActiveEndpoints: unwired("webhooks.listActiveEndpoints"),
  getEndpoint: unwired("webhooks.getEndpoint"),
  recordDelivery: unwired("webhooks.recordDelivery"),
  getDelivery: unwired("webhooks.getDelivery"),
  listDeliveries: unwired("webhooks.listDeliveries"),
  getRecentAttempts: unwired("webhooks.getRecentAttempts"),
  countConsecutiveFailures: unwired("webhooks.countConsecutiveFailures"),
  disableEndpoint: unwired("webhooks.disableEndpoint"),
};

// --- Notification directory: UNWIRED until T02 (needs users/documents) -------
const notifications = {
  getEventNotificationTarget: unwired("notifications.getEventNotificationTarget"),
};

// --- Queues (spec §12 — T17 owns events/email/webhooks) ----------------------
const queues = {
  [QUEUES.events]: new Queue(QUEUES.events, {
    connection,
    ...(QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.events] ? { defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.events] } : {}),
  }),
  [QUEUES.email]: new Queue(QUEUES.email, {
    connection,
    ...(QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.email] ? { defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.email] } : {}),
  }),
  [QUEUES.webhooks]: new Queue(QUEUES.webhooks, {
    connection,
    ...(QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.webhooks]
      ? { defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.webhooks] }
      : {}),
  }),
  // T16 (issue #16): assets queue — scan + process-image (spec §12).
  [QUEUES.assets]: new Queue(QUEUES.assets, {
    connection,
    ...(QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.assets] ? { defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.assets] } : {}),
  }),
  // T29 (spec §17 GDPR): maintenance queue — retention + workspace purges.
  [QUEUES.maintenance]: new Queue(QUEUES.maintenance, {
    connection,
    ...(QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.maintenance]
      ? { defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS[QUEUES.maintenance] }
      : {}),
  }),
  // T18/T19: create the exports/analytics Queues here (same
  // pattern) and register processors in src/jobs/registry.ts.
};

// --- Deps --------------------------------------------------------------------
const queuePort = createBullQueuePort(queues);

const deps: WorkerDeps = {
  clock: { now: () => new Date() },
  logger,
  queue: queuePort,
  events: eventsRepository,
  webhooks: webhooksRepository,
  notifications,
  // T16 assets wiring (spec §12): S3/MinIO via env, in-memory dev fallback.
  // INTEGRATION-DEBT: the asset-row repository follows the same T02 posture as
  // events/webhooks above — swap the stub for
  //   createAssetsRepository(createDb(config.databaseUrl))
  // (packages/db/src/repositories/assets.ts) once the worker gains the db dep.
  assets: {
    getByIdUnscoped: unwired("assets.getByIdUnscoped"),
    patch: unwired("assets.patch"),
  },
  store: objectStoreFromEnv(process.env),
  // Dev default: no AV wired → scan jobs resolve `unavailable` → `skipped`
  // (spec §12 "or `skipped` in dev"). A ClamAV adapter swaps in here.
  scanner: { scan: async () => "unavailable" },
  mailer,
  // T29 (spec §17): webhook egress goes through the SSRF guard — URL policy +
  // DNS-then-resolved-IP connect (blocks 169.254.169.254 / 10.x / 127.0.0.1 /
  // ::1 / DNS-rebinding). Injected here so EVERY delivery attempt, including
  // retries and replays, is guarded (tests inject fakes via deps.post).
  post: createSsrfSafePost(),
  // T29 (spec §17 GDPR): retention + workspace purge job stores, over the DB
  // when configured. NOTE: the maintenance plane must reach Postgres with a
  // role that may touch every tenant (RLS is per-workspace; see
  // packages/db/src/repositories/gdpr.ts header + docs/backups-restore-runbook.md).
  ...(config.databaseUrl
    ? (() => {
        const pool = new Pool({ connectionString: config.databaseUrl });
        const exec = {
          async query(text: string, params?: readonly unknown[]) {
            const result = await pool.query(text, (params ?? []) as unknown[]);
            return { rows: result.rows as Record<string, unknown>[] };
          },
        };
        return {
          gdpr: {
            retention: createGdprRetentionStore(exec),
            workspaces: createGdprWorkspaceStore(exec),
            workspaceGraceDays: Number(process.env["GDPR_WORKSPACE_GRACE_DAYS"] ?? 30),
          },
        };
      })()
    : {}),
  jitter: () => Math.random(),
  // INTEGRATION-DEBT: switch to uuidv7() from the T02 kernel (spec §4 ids).
  newId: () => crypto.randomUUID(),
  appUrl: config.appUrl,
};

// --- Workers from the registry ----------------------------------------------
const registry = registerJobs(deps);

const workers = Object.entries(registry).map(([queueName, handlers]) => {
  if (!handlers) throw new Error(`empty registry for queue ${queueName}`);
  return new Worker(
    queueName,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`no processor registered for ${queueName}/${job.name}`);
      await handler({ id: job.id, name: job.name, data: job.data });
    },
    { connection, concurrency: config.concurrency },
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info("worker.shutting-down", { signal });
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  connection.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

logger.info("worker.started", {
  queues: Object.keys(queues).join(","),
  redis: config.redisUrl,
  mailer: config.resendApiKey ? "resend" : "console-dev",
  dbWired: "false (INTEGRATION-DEBT T02)",
});
