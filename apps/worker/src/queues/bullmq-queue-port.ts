// BullMQ adapter for the QueuePort — the ONLY file in business land that knows
// about BullMQ job options. Queue-level defaults live here:
//   - events:   3 attempts, exponential 5s (fan-out is cheap + idempotent)
//   - email:    5 attempts, exponential 30s (spec §12 "retry 5× exponential")
//   - webhooks: 1 attempt — retries are SELF-managed by the deliver job so the
//     exact schedule (1m/5m/30m/2h/12h + bounded jitter) is preserved.
import type { DefaultJobOptions, Queue } from "bullmq";
import type { EnqueueOptions, EnqueueResult, QueuePort } from "../ports";
import { QUEUES, type JobName, type QueueName } from "./names";

export const QUEUE_DEFAULT_JOB_OPTIONS: Partial<Record<QueueName, DefaultJobOptions>> = {
  [QUEUES.events]: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 3 * 24 * 3_600_000 },
    removeOnFail: { age: 7 * 24 * 3_600_000 },
  },
  [QUEUES.email]: {
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 24 * 3_600_000 },
    removeOnFail: { age: 7 * 24 * 3_600_000 },
  },
  [QUEUES.webhooks]: {
    attempts: 1,
    removeOnComplete: { age: 7 * 24 * 3_600_000 },
    removeOnFail: { age: 7 * 24 * 3_600_000 },
  },
};

export function createBullQueuePort(queues: Partial<Record<QueueName, Queue>>): QueuePort {
  return {
    async enqueue(
      queue: QueueName,
      jobName: JobName,
      data: unknown,
      options?: EnqueueOptions,
    ): Promise<EnqueueResult> {
      const target = queues[queue];
      if (!target) {
        throw new Error(`queue "${queue}" is not wired in this worker (add it in src/index.ts)`);
      }
      const job = await target.add(jobName, data, {
        ...(options?.jobId !== undefined ? { jobId: options.jobId } : {}),
        ...(options?.delayMs !== undefined && options.delayMs > 0 ? { delay: options.delayMs } : {}),
      });
      return { jobId: job.id ?? null };
    },
  };
}
