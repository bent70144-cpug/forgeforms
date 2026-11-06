// `email` queue processor (spec §12: Resend; retry 5× exponential).
//
// SPEC-NOTE: "retry 5× exponential" is implemented as 5 total attempts
// (4 retries) with BullMQ exponential backoff (30s base) configured as the
// `email` queue's defaultJobOptions in src/index.ts. The processor itself
// performs a single send attempt; failures propagate as thrown AppErrors so
// BullMQ owns the retry schedule. Later tickets (T03 verify/reset, T18
// export-ready) render + enqueue; this processor stays transport-only.
import { ok, type AppError, type Result } from "@formforge/core/bridge";
import { systemCtx, type WorkerDeps } from "../ports";
import { parseEmailJobData } from "./contracts";

export type EmailSendSummary = { messageId: string; kind: string; to: string };

export async function processEmailJob(
  deps: WorkerDeps,
  jobId: string | undefined,
  data: unknown,
): Promise<Result<EmailSendSummary, AppError>> {
  const parsed = parseEmailJobData(data);
  if (!parsed.ok) return parsed;
  const message = parsed.value;
  const ctx = systemCtx({
    // workspaceId may be unknown for verify/reset mails — correlation only.
    workspaceId: message.meta?.workspaceId ?? "system",
    requestId: `email:${jobId ?? message.kind}`,
    clock: deps.clock,
  });

  const result = await deps.mailer.send({
    to: message.to,
    subject: message.subject,
    html: message.html,
    ...(message.text !== undefined ? { text: message.text } : {}),
  });

  if (!result.ok) {
    // No message content in logs — metadata only (spec §4).
    deps.logger.error("email.send-failed", {
      kind: message.kind,
      to: message.to,
      code: result.error.code,
      error: result.error.message,
      requestId: ctx.requestId,
    });
    return { ok: false, error: result.error };
  }

  deps.logger.info("email.sent", {
    kind: message.kind,
    to: message.to,
    messageId: result.value.id,
    requestId: ctx.requestId,
  });
  return ok({ messageId: result.value.id, kind: message.kind, to: message.to });
}
