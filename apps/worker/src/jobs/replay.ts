// Replay service — T17 (issue #17): "Replay re-delivers and logs a new attempt."
//
// The Integrate screen's replay button (POST /webhooks/:id/deliveries/:did/replay)
// will call `replayDelivery` via the CRUD API; `replayJob` accepts a BullMQ job
// id (`wh:<webhookId>:<eventId>:a<attempt>[:r<deliveryId>]`) for ops tooling.
//
// Semantics: a replay is a NEW deliver job with the ORIGINAL attempt number and
// a `replayOfDeliveryId`, so it gets its own row in the delivery log (new id +
// new created_at make the chronology unambiguous — the schema has no replay
// flag column, and T17 must not touch src/schema/**).
import { AppError, err, ok, type Result } from "@formforge/core";;
import { JOBS, QUEUES } from "../queues/names";
import type { WorkerDeps } from "../ports";

export type ReplayResult = { jobId: string; webhookId: string; eventId: string; attempt: number };

export function replayJobIdFor(args: {
  webhookId: string;
  eventId: string;
  attempt: number;
  replayOfDeliveryId: string;
}): string {
  return `wh:${args.webhookId}:${args.eventId}:a${args.attempt}:r${args.replayOfDeliveryId}`;
}

/** Re-deliver a specific recorded attempt and log a new row. */
export async function replayDelivery(
  deps: WorkerDeps,
  deliveryId: string,
): Promise<Result<ReplayResult, AppError>> {
  const delivery = await deps.webhooks.getDelivery(deliveryId);
  if (!delivery) return err(new AppError("NOT_FOUND", `delivery ${deliveryId} not found`));
  return enqueueReplay(deps, {
    webhookId: delivery.webhookId,
    eventId: delivery.eventId,
    attempt: delivery.attempt,
    replayOfDeliveryId: delivery.id,
  });
}

/**
 * Re-deliver from a deliver job id. If the id points at a replay job, that
 * exact delivery is replayed; otherwise the most recent attempt for the
 * (webhookId, eventId) pair is used.
 */
export async function replayJob(deps: WorkerDeps, jobId: string): Promise<Result<ReplayResult, AppError>> {
  const parsed = parseDeliverJobId(jobId);
  if (!parsed.ok) return parsed;
  if (parsed.value.replayOfDeliveryId) {
    return replayDelivery(deps, parsed.value.replayOfDeliveryId);
  }
  const deliveries = await deps.webhooks.listDeliveries(parsed.value.webhookId, 100);
  const latest = deliveries.find((delivery) => delivery.eventId === parsed.value.eventId);
  if (!latest) {
    return err(
      new AppError("NOT_FOUND", `no recorded delivery for webhook ${parsed.value.webhookId} and event ${parsed.value.eventId}`),
    );
  }
  return enqueueReplay(deps, {
    webhookId: latest.webhookId,
    eventId: latest.eventId,
    attempt: latest.attempt,
    replayOfDeliveryId: latest.id,
  });
}

async function enqueueReplay(
  deps: WorkerDeps,
  args: { webhookId: string; eventId: string; attempt: number; replayOfDeliveryId: string },
): Promise<Result<ReplayResult, AppError>> {
  const jobId = replayJobIdFor(args);
  const enqueued = await deps.queue.enqueue(
    QUEUES.webhooks,
    JOBS.deliver,
    {
      eventId: args.eventId,
      webhookId: args.webhookId,
      attempt: args.attempt,
      replayOfDeliveryId: args.replayOfDeliveryId,
    },
    { jobId },
  );
  deps.logger.info("webhook.replay-enqueued", {
    webhookId: args.webhookId,
    eventId: args.eventId,
    attempt: args.attempt,
    replayOfDeliveryId: args.replayOfDeliveryId,
    jobId: enqueued.jobId ?? jobId,
  });
  return ok({ jobId: enqueued.jobId ?? jobId, webhookId: args.webhookId, eventId: args.eventId, attempt: args.attempt });
}

type ParsedDeliverJobId = {
  webhookId: string;
  eventId: string;
  attempt: number;
  replayOfDeliveryId: string | null;
};

/** `wh:<webhookId>:<eventId>:a<attempt>[:r<deliveryId>]` — ids never contain ":" (uuids). */
export function parseDeliverJobId(jobId: string): Result<ParsedDeliverJobId, AppError> {
  const parts = jobId.split(":");
  if (parts.length !== 4 && parts.length !== 5) {
    return err(new AppError("VALIDATION", `not a deliver job id: ${jobId}`));
  }
  const [prefix, webhookId, eventId, attemptPart, replayPart] = parts;
  if (prefix !== "wh" || !webhookId || !eventId) {
    return err(new AppError("VALIDATION", `not a deliver job id: ${jobId}`));
  }
  const attemptMatch = /^a(\d+)$/.exec(attemptPart ?? "");
  if (!attemptMatch) return err(new AppError("VALIDATION", `not a deliver job id: ${jobId}`));
  const replayOfDeliveryId =
    parts.length === 5 ? (replayPart?.startsWith("r") ? replayPart.slice(1) : null) : null;
  if (parts.length === 5 && !replayOfDeliveryId) {
    return err(new AppError("VALIDATION", `not a deliver job id: ${jobId}`));
  }
  return ok({
    webhookId,
    eventId,
    attempt: Number.parseInt(attemptMatch[1] as string, 10),
    replayOfDeliveryId,
  });
}
