// Job registry — the single place queue topology meets business logic.
//
// T18/T19: add your jobs here WITHOUT touching anything else, e.g.
//   [QUEUES.exports]: { [JOBS.csvExport]: makeCsvExportProcessor(deps) },
//   [QUEUES.analytics]: { [JOBS.ingestBatch]: ..., [JOBS.rollup]: ... },
// then create the queue in src/index.ts `QUEUES_TO_WIRE` if missing.
// Everything else (config, ports, workers, shutdown) is already generic.
import type { AppError, Result, WorkerDeps } from "../ports";
import { JOBS, QUEUES, type QueueName } from "../queues/names";
import { processEmailJob } from "./email";
import { processEventFanout } from "./event-fanout";
import { processWebhookDeliver } from "./webhook-deliver";

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
  };
}
