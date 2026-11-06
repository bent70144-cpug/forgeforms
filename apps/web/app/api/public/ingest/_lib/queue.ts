// apps/web/app/api/public/ingest/_lib/queue.ts
// BullMQ producer for the `events` queue (spec §12). The worker consumer is
// stubbed until T17; fan-out (notification email, webhooks, analytics) reads
// the `submission.completed` job payload documented in §12.
//
// NOTE (untested here): not exercised by the vitest suite; tests use the
// in-memory CaptureEventQueue from @formforge/core.

import { Queue } from "bullmq";
import type { EventQueue, IngestEvent } from "@formforge/core/submissions";

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

export function createBullMqEventQueue(url: string): EventQueue {
  const queue = new Queue<IngestEvent>("events", { connection: connectionOptions(url) });
  return {
    async enqueue(event: IngestEvent): Promise<void> {
      // jobId = event id → BullMQ dedupes replayed enqueues.
      await queue.add(event.type, event, { jobId: event.id, attempts: 5, removeOnComplete: 1000 });
    },
  };
}
