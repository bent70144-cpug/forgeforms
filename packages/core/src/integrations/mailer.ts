// Mailer port + notification email renderers — T17 (issue #17).
//
// Transport is injected (Resend in prod, console in dev); rendering is pure so
// it is unit-testable without any transport. Rendering NEVER includes answer
// values (spec §4 logging rule / issue #17 "never log answer values").
import { type AppError } from "../shared/errors.ts";
import { type Result } from "../shared/result.ts";

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Defaults to the mailer's configured from-address when omitted. */
  from?: string;
  replyTo?: string;
};

export type MailSendResult = { id: string };

/** Transport port. Implementations MUST NOT throw; return Result instead (spec §3). */
export type Mailer = {
  send(message: MailMessage): Promise<Result<MailSendResult, AppError>>;
};

/** Queue job names on the `email` queue (spec §12). T18 reuses `send-export-ready`. */
export const EMAIL_JOB_NAMES = ["send-notification", "send-export-ready", "send-verify", "send-reset"] as const;
export type EmailJobName = (typeof EMAIL_JOB_NAMES)[number];

export type NotificationEmailInput = {
  documentTitle: string | null;
  documentId: string;
  submissionId: string;
  occurredAt: string;
  /** Absolute URL to the results screen; built by the worker from config. */
  resultsUrl: string;
};

/** Subject + html + text for the `submission.completed` owner notification. Pure. */
export function renderNotificationEmail(input: NotificationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const title = input.documentTitle ?? "Untitled document";
  const subject = `New submission — ${title}`;
  const when = input.occurredAt;
  const text = [
    "A new submission was completed.",
    "",
    `Document: ${title}`,
    `Submission: ${input.submissionId}`,
    `Completed at: ${when}`,
    "",
    `View it here: ${input.resultsUrl}`,
  ].join("\n");
  const html = [
    "<p>A new submission was completed.</p>",
    "<ul>",
    `<li>Document: ${escapeHtml(title)}</li>`,
    `<li>Submission: <code>${escapeHtml(input.submissionId)}</code></li>`,
    `<li>Completed at: ${escapeHtml(when)}</li>`,
    "</ul>",
    `<p><a href="${escapeHtml(input.resultsUrl)}">View results</a></p>`,
  ].join("\n");
  return { subject, html, text };
}

export type WebhookDisabledEmailInput = {
  endpointUrl: string;
  documentTitle: string | null;
  consecutiveFailures: number;
};

/** Subject + html + text for the auto-disable owner notification. Pure. */
export function renderWebhookDisabledEmail(input: WebhookDisabledEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "Webhook disabled after repeated failures";
  const title = input.documentTitle ?? "your workspace";
  const text = [
    "Your FormForge webhook has been disabled.",
    "",
    `Endpoint: ${input.endpointUrl}`,
    `Consecutive failures: ${input.consecutiveFailures}`,
    "",
    `Re-enable it and check the delivery log in ${title} → Integrate.`,
  ].join("\n");
  const html = [
    "<p>Your FormForge webhook has been disabled.</p>",
    "<ul>",
    `<li>Endpoint: <code>${escapeHtml(input.endpointUrl)}</code></li>`,
    `<li>Consecutive failures: ${input.consecutiveFailures}</li>`,
    "</ul>",
    `<p>Re-enable it and check the delivery log in ${escapeHtml(title)} → Integrate.</p>`,
  ].join("\n");
  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Convenience: wrap an already-rendered message into an enqueue-ready MailMessage. Pure. */
export function toMailMessage(rendered: { subject: string; html: string; text: string }, to: string): MailMessage {
  return { to, subject: rendered.subject, html: rendered.html, text: rendered.text };
}
