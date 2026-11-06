// Job registry — the single place queue topology meets business logic.
//
// T18/T19: add your jobs here WITHOUT touching anything else, e.g.
//   [QUEUES.exports]: { [JOBS.csvExport]: makeCsvExportProcessor(deps) },
//   [QUEUES.analytics]: { [JOBS.ingestBatch]: ..., [JOBS.rollup]: ... },
// then create the queue in src/index.ts `QUEUES_TO_WIRE` if missing.
// Everything else (config, ports, workers, shutdown) is already generic.
import type { AppError, Result, WorkerDeps } from "../ports";
import { JOBS, QUEUES, type QueueName } from "../queues/names";
import { processProcessImageJob } from "./assets-process-image";
import { processScanJob as processAssetsScan } from "./assets-scan";
import { createCsvExportJobHandler, CSV_EXPORT_JOB } from "./csv-export";
import { processEmailJob } from "./email";
import { processEventFanout } from "./event-fanout";
import { processRetentionPurge } from "./retention-purge";
import { processWebhookDeliver } from "./webhook-deliver";
import type { ExportSubmissionRow, SubmissionReader, ExportJobStore } from "@formforge/core/export";

export type JobInput = { id?: string; name: string; data: unknown };

export type JobProcessor = (job: JobInput) => Promise<void>;

export type QueueRegistry = Partial<Record<QueueName, Record<string, JobProcessor>>>;

function unwrapIntoProcessor(
  fn: (deps: WorkerDeps, jobId: string | undefined, data: unknown) => Promise<Result<unknown, AppError>>,
  deps: WorkerDeps,
): JobProcessor {
  return async (job) => {
    const result = await fn(deps, job.id, job.data);
    if (!result.ok) {
      // Throwing marks the BullMQ job failed → queue-level retries apply.
      // (Business "failures" like HTTP 500 webhooks return ok(...) — they
      // schedule their own exact-backoff retries instead.)
      throw result.error;
    }
  };
}

function emailProcessor(deps: WorkerDeps): JobProcessor {
  return unwrapIntoProcessor((d, jobId, data) => processEmailJob(d, jobId, data), deps);
}

// ---------------------------------------------------------------------------
// T18 (issue #30): exports queue. The store/mailer/appUrl/clock come from
// WorkerDeps; the submissions stream + export-jobs store stay unwired (loud
// failure) until the db-backed readers land with the API wiring (re-ticketed
// with the issue #30 follow-up — same posture as the events/webhooks stubs).
// ---------------------------------------------------------------------------
function loudSubmissionReader(): SubmissionReader {
  return {
    // eslint-disable-next-line require-yield
    async *streamByCursor(): AsyncIterable<ExportSubmissionRow> {
      throw new Error(
        "db not wired: csv-export streamByCursor needs the submissions export reader (re-ticketed with the issue #30 follow-up)",
      );
    },
  };
}

function loudExportJobStore(): ExportJobStore {
  const fail = () => {
    throw new Error(
      "db not wired: csv-export job store needs createExportJobsRepo(createDb(...)) (re-ticketed with the issue #30 follow-up)",
    );
  };
  return {
    markRunning: fail,
  } as unknown as ExportJobStore;
}

function csvExportProcessor(deps: WorkerDeps): JobProcessor {
  const handle = createCsvExportJobHandler({
    store: deps.store,
    mailer: {
      // Adapter: the worker mailer returns kernel Result (integrations);
      // the export flow uses the throwing transport contract (see
      // @formforge/core/export/ports.ts).
      async send(message: { to: string; subject: string; text: string; html?: string }) {
        const result = await deps.mailer.send({ ...message, html: message.html ?? "" });
        if (!result.ok) throw result.error;
      },
    },
    submissions: loudSubmissionReader(),
    jobs: loudExportJobStore(),
    config: { secret: deps.exportSigningSecret ?? "", baseUrl: deps.appUrl },
    now: deps.clock.now,
    log: (entry) =>
      deps.logger.info(
        "worker.csv_export",
        Object.fromEntries(
          Object.entries(entry).map(([k, v]) => [
            k,
            typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null ? v : String(v),
          ]),
        ),
      ),
  });
  return async (job) => handle(job);
}

export function registerJobs(deps: WorkerDeps): QueueRegistry {
  return {
    [QUEUES.events]: {
      [JOBS.submissionCompleted]: unwrapIntoProcessor(
        (d, _jobId, data) => processEventFanout(d, data),
        deps,
      ),
    },
    [QUEUES.email]: {
      [JOBS.sendNotification]: emailProcessor(deps),
      // Registered for T18/T03 — same transport, different rendered payloads.
      [JOBS.sendExportReady]: emailProcessor(deps),
      [JOBS.sendVerify]: emailProcessor(deps),
      [JOBS.sendReset]: emailProcessor(deps),
    },
    [QUEUES.webhooks]: {
      [JOBS.deliver]: unwrapIntoProcessor((d, jobId, data) => processWebhookDeliver(d, jobId, data), deps),
    },
    // T16 (issue #16) — assets queue (spec §12): scan + WebP/AVIF planning.
    [QUEUES.assets]: {
      [JOBS.scan]: unwrapIntoProcessor((d, jobId, data) => processAssetsScan(d, jobId, data), deps),
      [JOBS.processImage]: unwrapIntoProcessor((d, jobId, data) => processProcessImageJob(d, jobId, data), deps),
    },
    // T29 (spec §17 GDPR) — maintenance queue: retention + workspace purges.
    // Enqueue on a daily cron/Repeat (see docs/security-checklist.md §17).
    [QUEUES.maintenance]: {
      [JOBS.purgeRetention]: unwrapIntoProcessor((d, jobId, data) => processRetentionPurge(d, jobId, data), deps),
    },
    // T18 (issue #18, registered in issue #30) — CSV exports.
    [QUEUES.exports]: {
      [CSV_EXPORT_JOB]: csvExportProcessor(deps),
    },
    // T19 (issue #19, registered in issue #30) — analytics rollups. Handlers
    // arrive via deps.analytics only when DATABASE_URL is configured; the
    // queue still starts and fails loudly otherwise (spec §12 posture).
    [QUEUES.analytics]: {
      [JOBS.rollup]: async (job) => {
        if (!deps.analytics) throw new Error("db not wired: analytics rollup needs DATABASE_URL");
        await deps.analytics.rollup(job.data);
      },
      [JOBS.createPartitions]: async (job) => {
        if (!deps.analytics) throw new Error("db not wired: create-partitions needs DATABASE_URL");
        await deps.analytics["create-partitions"](job.data);
      },
    },
  };
}
