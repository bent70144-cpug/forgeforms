// `webhooks` queue — `deliver` job (spec §12 / issue #17).
//
// Retry model: BullMQ retries are OFF for this queue (attempts: 1) because the
// exact backoff schedule (1m, 5m, 30m, 2h, 12h + bounded jitter) is computed
// by the pure function in @formforge/core/integrations and applied by
// re-enqueueing the NEXT attempt with `delayMs`. Every attempt — initial,
// retries, replays — is recorded as a webhook_deliveries row.
//
// Auto-disable: after WEBHOOK_MAX_CONSECUTIVE_FAILURES (10) consecutive failed
// attempts the endpoint is disabled and the owner is notified by email.
//
// Never logs: answer values, endpoint secrets.
import { AppError, err, ok, type Result } from "@formforge/core";;
import {
  computeRetryDelayMs,
  deliverWebhook,
  parseSubmissionCompletedEvent,
  renderWebhookDisabledEmail,
  serializeWebhookBody,
  shouldDisableEndpoint,
  toMailMessage,
} from "@formforge/core/integrations";
import { JOBS, QUEUES } from "../queues/names";
import { systemCtx, type Ctx, type WorkerDeps } from "../ports";
import type { DeliverJobData } from "./contracts";
import { parseDeliverJobData } from "./contracts";

export type DeliverSummary =
  | { delivered: true; attempt: number; statusCode: number | null }
  | { retryScheduled: true; attempt: number; nextAttempt: number; delayMs: number }
  | { exhausted: true; attempt: number; consecutiveFailures: number }
  | { disabled: true; attempt: number; consecutiveFailures: number; ownerNotified: boolean }
  | { skipped: true; reason: "endpoint-disabled" | "not-subscribed" };

export function webhookDisabledEmailJobId(webhookId: string, eventId: string): string {
  return `mail:wh-disabled:${webhookId}:${eventId}`;
}

export async function processWebhookDeliver(
  deps: WorkerDeps,
  jobId: string | undefined,
  data: unknown,
): Promise<Result<DeliverSummary, AppError>> {
  const parsed = parseDeliverJobData(data);
  if (!parsed.ok) return parsed;
  const job: DeliverJobData = parsed.value;

  const eventRow = await deps.events.getEvent(job.eventId);
  if (!eventRow) return err(new AppError("NOT_FOUND", `event ${job.eventId} not found`));
  const event = parseSubmissionCompletedEvent(eventRow.payload);
  if (!event.ok) return event;

  const ctx: Ctx = systemCtx({ workspaceId: event.value.workspaceId, requestId: jobId ?? `deliver:${job.eventId}`, clock: deps.clock });

  const endpoint = await deps.webhooks.getEndpoint(job.webhookId);
  if (!endpoint) return err(new AppError("NOT_FOUND", `webhook endpoint ${job.webhookId} not found`));

  if (!endpoint.enabled) {
    deps.logger.info("webhook.skipped", { webhookId: endpoint.id, eventId: event.value.id, reason: "endpoint-disabled" });
    return ok({ skipped: true, reason: "endpoint-disabled" });
  }
  if (!endpoint.events.includes(event.value.type)) {
    deps.logger.info("webhook.skipped", { webhookId: endpoint.id, eventId: event.value.id, reason: "not-subscribed" });
    return ok({ skipped: true, reason: "not-subscribed" });
  }

  // Byte-stable body: identical across attempts and replays (canonical JSON),
  // so signatures are reproducible and consumers can verify deterministically.
  const body = serializeWebhookBody(event.value);
  const timestampSeconds = Math.floor(ctx.now().getTime() / 1000);

  const outcome = await deliverWebhook({
    target: { id: endpoint.id, url: endpoint.url, secret: endpoint.secret },
    body,
    timestampSeconds,
    post: deps.post,
    ...(deps.webhookTimeoutMs !== undefined ? { timeoutMs: deps.webhookTimeoutMs } : {}),
  });

  // Record the attempt — every attempt is visible in the delivery log.
  await deps.webhooks.recordDelivery({
    id: deps.newId(),
    webhookId: endpoint.id,
    eventId: event.value.id,
    attempt: job.attempt,
    statusCode: outcome.statusCode,
    ok: outcome.ok,
    durationMs: outcome.durationMs,
    error: outcome.error,
  });

  if (outcome.ok) {
    deps.logger.info("webhook.delivered", {
      webhookId: endpoint.id,
      eventId: event.value.id,
      attempt: job.attempt,
      statusCode: outcome.statusCode,
      durationMs: outcome.durationMs,
      requestId: ctx.requestId,
    });
    return ok({ delivered: true, attempt: job.attempt, statusCode: outcome.statusCode });
  }

  deps.logger.warn("webhook.delivery-failed", {
    webhookId: endpoint.id,
    eventId: event.value.id,
    attempt: job.attempt,
    statusCode: outcome.statusCode,
    error: outcome.error,
    requestId: ctx.requestId,
  });

  // Auto-disable check BEFORE scheduling another retry.
  const consecutiveFailures = await deps.webhooks.countConsecutiveFailures(endpoint.id);
  if (shouldDisableEndpoint(consecutiveFailures)) {
    const disabled = await deps.webhooks.disableEndpoint(endpoint.id);
    let ownerNotified = false;
    if (disabled) {
      const target = await deps.notifications.getEventNotificationTarget({
        workspaceId: event.value.workspaceId,
        documentId: event.value.documentId,
      });
      if (target) {
        const rendered = renderWebhookDisabledEmail({
          endpointUrl: endpoint.url,
          documentTitle: target.documentTitle,
          consecutiveFailures,
        });
        await deps.queue.enqueue(
          QUEUES.email,
          JOBS.sendNotification,
          {
            ...toMailMessage(rendered, target.email),
            kind: JOBS.sendNotification,
            meta: { eventId: event.value.id, webhookId: endpoint.id },
          },
          { jobId: webhookDisabledEmailJobId(endpoint.id, event.value.id) },
        );
        ownerNotified = true;
      }
    }
    deps.logger.warn("webhook.endpoint-disabled", {
      webhookId: endpoint.id,
      eventId: event.value.id,
      consecutiveFailures,
      ownerNotified,
      requestId: ctx.requestId,
    });
    return ok({ disabled: true, attempt: job.attempt, consecutiveFailures, ownerNotified });
  }

  // Schedule the next attempt on the exact backoff schedule (+ bounded jitter).
  const delayMs = computeRetryDelayMs(job.attempt, deps.jitter);
  if (delayMs === null) {
    deps.logger.warn("webhook.retries-exhausted", {
      webhookId: endpoint.id,
      eventId: event.value.id,
      attempt: job.attempt,
      consecutiveFailures,
      requestId: ctx.requestId,
    });
    return ok({ exhausted: true, attempt: job.attempt, consecutiveFailures });
  }
  const nextAttempt = job.attempt + 1;
  await deps.queue.enqueue(
    QUEUES.webhooks,
    JOBS.deliver,
    {
      eventId: job.eventId,
      webhookId: job.webhookId,
      attempt: nextAttempt,
      ...(job.replayOfDeliveryId !== undefined ? { replayOfDeliveryId: job.replayOfDeliveryId } : {}),
    },
    { jobId: nextDeliverJobId(job), delayMs },
  );
  deps.logger.info("webhook.retry-scheduled", {
    webhookId: endpoint.id,
    eventId: event.value.id,
    attempt: job.attempt,
    nextAttempt,
    delayMs,
    requestId: ctx.requestId,
  });
  return ok({ retryScheduled: true, attempt: job.attempt, nextAttempt, delayMs });
}

/**
 * Deterministic job id for the follow-up attempt. A chain continues the
 * `wh:<webhookId>:<eventId>:a<attempt>` id space; replays (which carry a
 * distinct `replayOfDeliveryId`) keep their unique replay id so a replayed
 * chain never collides with the original one.
 */
function nextDeliverJobId(job: DeliverJobData): string {
  const next = `wh:${job.webhookId}:${job.eventId}:a${job.attempt + 1}`;
  return job.replayOfDeliveryId === undefined ? next : `${next}:r${job.replayOfDeliveryId}`;
}
