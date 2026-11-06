// `events` queue — `submission.completed` fan-out job (spec §12 / issue #17).
//
// Fan-out rules:
//   1. the event row is persisted EXACTLY ONCE (insertEventOnce is idempotent);
//   2. redeliveries of an already-processed event are skipped;
//   3. side effects are independent jobs on the `email` / `webhooks` queues
//      with deterministic job ids, so a fan-out retry can never duplicate an
//      email or a delivery chain;
//   4. one failing webhook enqueue must not block the others (isolated).
//
// SPEC-NOTE: issue #17 mentions an "analytics hook" in the fan-out; spec §12
// triggers the `analytics` queue from beacons/cron instead. We provide the
// seam (deps.analyticsHook) but do not enqueue analytics by default — T19
// decides whether to use it.
import { ok, type AppError, type Result } from "@formforge/core";;
import {
  parseSubmissionCompletedEvent,
  renderNotificationEmail,
  type SubmissionCompletedEvent,
} from "@formforge/core/integrations";
import { JOBS, QUEUES } from "../queues/names";
import { systemCtx, type Ctx, type WorkerDeps } from "../ports";
import { resultsUrlFor } from "../config";

export type FanoutSummary = {
  eventId: string;
  eventCreated: boolean;
  emailEnqueued: boolean;
  webhooksEnqueued: number;
  webhookEnqueueFailures: number;
  skipped?: "already-processed";
};

export function notificationEmailJobId(eventId: string): string {
  return `mail:notification:${eventId}`;
}

export function webhookDeliverJobId(webhookId: string, eventId: string, attempt: number): string {
  return `wh:${webhookId}:${eventId}:a${attempt}`;
}

/** Pure-ish orchestrator: no I/O beyond the injected ports. */
export async function processEventFanout(
  deps: WorkerDeps,
  data: unknown,
): Promise<Result<FanoutSummary, AppError>> {
  const parsed = parseSubmissionCompletedEvent(data);
  if (!parsed.ok) return parsed;
  const event: SubmissionCompletedEvent = parsed.value;
  const ctx: Ctx = systemCtx({
    workspaceId: event.workspaceId,
    requestId: `fanout:${event.id}`,
    clock: deps.clock,
  });

  // 1. Persist exactly once.
  const insert = await deps.events.insertEventOnce({
    id: event.id,
    workspaceId: event.workspaceId,
    type: event.type,
    documentId: event.documentId,
    payload: event,
    occurredAt: new Date(event.occurredAt),
  });

  // 2. Skip redeliveries of an already-processed event.
  if (!insert.created) {
    const existing = await deps.events.getEvent(event.id);
    if (existing?.processedAt) {
      deps.logger.info("fanout.skipped", { eventId: event.id, reason: "already-processed" });
      return ok({
        eventId: event.id,
        eventCreated: false,
        emailEnqueued: false,
        webhooksEnqueued: 0,
        webhookEnqueueFailures: 0,
        skipped: "already-processed",
      });
    }
  }

  let emailEnqueued = false;
  let webhooksEnqueued = 0;
  let webhookEnqueueFailures = 0;

  // 3a. Notification email to the document owner.
  const target = await deps.notifications.getEventNotificationTarget({
    workspaceId: event.workspaceId,
    documentId: event.documentId,
  });
  if (target) {
    const rendered = renderNotificationEmail({
      documentTitle: target.documentTitle,
      documentId: event.documentId,
      submissionId: event.data.submissionId,
      occurredAt: event.occurredAt,
      resultsUrl: resultsUrlFor(deps.appUrl, event.documentId),
    });
    await deps.queue.enqueue(QUEUES.email, JOBS.sendNotification, toMailMessageMeta(rendered, target.email, event), {
      jobId: notificationEmailJobId(event.id),
    });
    emailEnqueued = true;
  } else {
    deps.logger.warn("fanout.no-notification-target", { eventId: event.id, documentId: event.documentId });
  }

  // 3b. Webhook deliveries — isolated per endpoint.
  const endpoints = await deps.webhooks.listActiveEndpoints({
    workspaceId: event.workspaceId,
    documentId: event.documentId,
    eventType: event.type,
  });
  for (const endpoint of endpoints) {
    try {
      await deps.queue.enqueue(QUEUES.webhooks, JOBS.deliver, { eventId: event.id, webhookId: endpoint.id, attempt: 0 }, {
        jobId: webhookDeliverJobId(endpoint.id, event.id, 0),
      });
      webhooksEnqueued += 1;
    } catch (cause) {
      webhookEnqueueFailures += 1;
      deps.logger.error("fanout.webhook-enqueue-failed", {
        eventId: event.id,
        webhookId: endpoint.id,
        error: (cause as Error)?.message ?? "unknown",
      });
    }
  }

  // 3c. Analytics hook seam (see SPEC-NOTE above) — isolated, never blocks.
  if (deps.analyticsHook) {
    try {
      await deps.analyticsHook(event);
    } catch (cause) {
      deps.logger.warn("fanout.analytics-hook-failed", {
        eventId: event.id,
        error: (cause as Error)?.message ?? "unknown",
      });
    }
  }

  // 4. Mark processed only after every side effect has been enqueued.
  await deps.events.markEventProcessed(event.id, ctx.now());

  deps.logger.info("fanout.completed", {
    eventId: event.id,
    workspaceId: event.workspaceId,
    documentId: event.documentId,
    emailEnqueued,
    webhooksEnqueued,
    webhookEnqueueFailures,
  });
  return ok({ eventId: event.id, eventCreated: insert.created, emailEnqueued, webhooksEnqueued, webhookEnqueueFailures });
}

/** EmailJobData with correlation meta (no answer values). */
function toMailMessageMeta(
  rendered: { subject: string; html: string; text: string },
  to: string,
  event: SubmissionCompletedEvent,
): {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: string;
  meta: Record<string, string>;
} {
  return {
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    kind: JOBS.sendNotification,
    meta: { eventId: event.id, documentId: event.documentId, submissionId: event.data.submissionId },
  };
}
