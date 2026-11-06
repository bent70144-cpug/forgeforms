// Queue job data contracts + runtime parsers. Jobs arrive from Redis as raw
// JSON, so every processor validates its payload before acting (no zod here —
// zero new worker deps; these are narrow hand-rolled guards).
//
// These types ARE the producer contract:
//   - T14 (ingest) enqueues `parseSubmissionCompletedEvent`-shaped payloads on
//     the `events` queue with job name `submission.completed`;
//   - T18 enqueues `send-export-ready` email jobs (rendered) on the `email` queue.
import { AppError, err, ok, type Result } from "@formforge/core";;
import type { SubmissionCompletedEvent } from "@formforge/core/integrations";

/** `events` / `submission.completed` job data = the full event payload (spec §12). */
export type EventJobData = SubmissionCompletedEvent;

export type DeliverJobData = {
  eventId: string;
  webhookId: string;
  /** 0-based attempt counter; drives the exact backoff schedule. */
  attempt: number;
  /** Set when this delivery is a UI replay of an earlier attempt. */
  replayOfDeliveryId?: string;
};

export type EmailJobData = {
  /** Rendered message; producers render via @formforge/core renderers. */
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** One of the EMAIL_JOB_NAMES — free-form string so later tickets can extend. */
  kind: string;
  /** Correlation ids for the delivery log; never contains answer values. */
  meta?: Record<string, string>;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDeliverJobData(data: unknown): Result<DeliverJobData, AppError> {
  if (!isRecord(data)) return err(new AppError("VALIDATION", "deliver job data must be an object"));
  const eventId = asString(data.eventId);
  const webhookId = asString(data.webhookId);
  if (!eventId) return err(new AppError("VALIDATION", "deliver.eventId is required"));
  if (!webhookId) return err(new AppError("VALIDATION", "deliver.webhookId is required"));
  if (typeof data.attempt !== "number" || !Number.isInteger(data.attempt) || data.attempt < 0) {
    return err(new AppError("VALIDATION", "deliver.attempt must be a non-negative integer"));
  }
  const parsedReplay =
    data.replayOfDeliveryId === undefined ? undefined : asString(data.replayOfDeliveryId);
  if (data.replayOfDeliveryId !== undefined && parsedReplay === null) {
    return err(new AppError("VALIDATION", "deliver.replayOfDeliveryId must be a non-empty string"));
  }
  const parsed: DeliverJobData = { eventId, webhookId, attempt: data.attempt };
  if (parsedReplay !== undefined && parsedReplay !== null) {
    parsed.replayOfDeliveryId = parsedReplay;
  }
  return ok(parsed);
}

export function parseEmailJobData(data: unknown): Result<EmailJobData, AppError> {
  if (!isRecord(data)) return err(new AppError("VALIDATION", "email job data must be an object"));
  const to = asString(data.to);
  const subject = asString(data.subject);
  const html = asString(data.html);
  const kind = asString(data.kind);
  if (!to) return err(new AppError("VALIDATION", "email.to is required"));
  if (!subject) return err(new AppError("VALIDATION", "email.subject is required"));
  if (!html) return err(new AppError("VALIDATION", "email.html is required"));
  if (!kind) return err(new AppError("VALIDATION", "email.kind is required"));
  if (data.meta !== undefined && !isRecord(data.meta)) {
    return err(new AppError("VALIDATION", "email.meta must be an object"));
  }
  if (data.text !== undefined && typeof data.text !== "string") {
    return err(new AppError("VALIDATION", "email.text must be a string"));
  }
  return ok({
    to,
    subject,
    html,
    kind,
    text: typeof data.text === "string" ? data.text : undefined,
    meta: data.meta as Record<string, string> | undefined,
  });
}
