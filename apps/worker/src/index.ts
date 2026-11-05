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
import { createConsoleMailer, createResendMailer } from "@formforge/core/integrations";
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
  // T18/T19: create the exports/analytics/assets/maintenance Queues here (same
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
  mailer,
  // Real transports: injectable in tests, direct fetch here.
  post: (url, init) => fetch(url, init),
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
