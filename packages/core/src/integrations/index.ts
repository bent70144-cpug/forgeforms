// @formforge/core — integrations module (T17, issue #17).
// Public interface per spec §3: mailer transports + renderers, webhook
// signing/backoff/dispatch, and the webhook/event payload contract.
// Kernel types come from ./bridge until T02 lands (INTEGRATION-DEBT).
export {
  AppError,
  ok,
  err,
  type AppErrorCode,
  type Ctx,
  type Result,
} from "../bridge";
export {
  EMAIL_JOB_NAMES,
  renderNotificationEmail,
  renderWebhookDisabledEmail,
  toMailMessage,
  type EmailJobName,
  type MailMessage,
  type Mailer,
  type MailSendResult,
  type NotificationEmailInput,
  type WebhookDisabledEmailInput,
} from "./mailer";
export { createConsoleMailer, type ConsoleMailerConfig } from "./console-mailer";
export { createResendMailer, type ResendMailerConfig } from "./resend-mailer";
export {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  buildSignatureHeader,
  computeWebhookSignature,
  parseSignatureHeader,
  verifyWebhookSignature,
  type ParsedSignatureHeader,
  type SignatureVerifyFailure,
  type SignatureVerifyResult,
} from "./webhook-signer";
export {
  WEBHOOK_JITTER_FRACTION,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_MAX_CONSECUTIVE_FAILURES,
  WEBHOOK_RETRY_BACKOFF_MS,
  baseRetryDelayMs,
  computeRetryDelayMs,
  shouldDisableEndpoint,
} from "./webhook-backoff";
export {
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_USER_AGENT,
  buildWebhookRequest,
  deliverWebhook,
  type DeliveryOutcome,
  type HttpPost,
  type WebhookRequest,
  type WebhookTarget,
} from "./webhook-dispatcher";
export {
  SUBMISSION_COMPLETED_EVENT_TYPE,
  canonicalJson,
  parseSubmissionCompletedEvent,
  serializeWebhookBody,
  type SubmissionCompletedEvent,
} from "./webhook-payload";
