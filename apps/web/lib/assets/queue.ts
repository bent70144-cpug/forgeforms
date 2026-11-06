// apps/web/lib/assets/queue.ts
// `assets` queue publisher (spec §12). BullMQ when REDIS_URL is configured;
// without Redis (local dev / tests) jobs are captured and dropped — the same
// posture as the ingest event queue in app/api/public/ingest/_lib/queue.ts.
//
// NOTE (untested here): not exercised by the vitest suite; unit tests inject
// fake AssetQueue seams directly into the service.

import { Queue } from "bullmq";
import type { AssetQueue } from "@formforge/core/assets";

/** Job names on the `assets` queue (apps/worker JOBS scan / process-image). */
export type AssetJobName = "scan" | "process-image";

function connectionOptions(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export function createBullMqAssetsQueue(url: string): AssetQueue {
  const queue = new Queue("assets", { connection: connectionOptions(url) });
  return {
    async enqueue(jobName: AssetJobName, data: unknown, jobId?: string): Promise<void> {
      // jobId = `scan:<assetId>` / `process-image:<assetId>` (produced by the
      // service) → BullMQ dedupes double-confirms.
      await queue.add(jobName, data, {
        ...(jobId ? { jobId } : {}),
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 1000,
      });
    },
  };
}

/** Dev/dev-test publisher: swallows jobs (no Redis). */
export function createCapturingAssetsQueue(sink?: (jobName: AssetJobName, data: unknown) => void): AssetQueue {
  return {
    async enqueue(jobName, data) {
      sink?.(jobName, data);
    },
  };
}

/** Env-driven choice used by the composition root. */
export function assetsQueueFromEnv(env: NodeJS.ProcessEnv = process.env): AssetQueue {
  return env.REDIS_URL ? createBullMqAssetsQueue(env.REDIS_URL) : createCapturingAssetsQueue();
}
