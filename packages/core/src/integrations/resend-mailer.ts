// Resend mailer — HTTP transport behind injected `fetch` (spec §1: Resend).
// Zero new deps: uses global fetch; injectable for tests. Never throws —
// returns Result per spec §3. Never logs message bodies (may contain answers).
import { err, ok, AppError, type Result } from "../bridge";
import type { MailMessage, Mailer, MailSendResult } from "./mailer";

export type ResendMailerConfig = {
  apiKey: string;
  /** Default from-address, e.g. `FormForge <notifications@formforge.dev>`. */
  from: string;
  /** Override for tests/proxies. Defaults to https://api.resend.com */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

type ResendResponseBody = { id?: unknown; data?: { id?: unknown }; message?: unknown };

export function createResendMailer(config: ResendMailerConfig): Mailer {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = (config.baseUrl ?? "https://api.resend.com").replace(/\/+$/, "");
  return {
    async send(message: MailMessage): Promise<Result<MailSendResult, AppError>> {
      const from = message.from ?? config.from;
      try {
        const response = await fetchImpl(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            ...(message.text !== undefined ? { text: message.text } : {}),
            ...(message.replyTo !== undefined ? { reply_to: message.replyTo } : {}),
          }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          // Never include the request body in the error (answers must not leak into logs).
          return err(
            new AppError("INTERNAL", `resend delivery failed with status ${response.status}`, {
              status: response.status,
              detail: detail.slice(0, 200),
            }),
          );
        }
        const body = (await response.json().catch(() => null)) as ResendResponseBody | null;
        const id = body?.id ?? body?.data?.id;
        if (typeof id !== "string" || id.length === 0) {
          return err(new AppError("INTERNAL", "resend response missing message id"));
        }
        return ok({ id });
      } catch (cause) {
        return err(new AppError("INTERNAL", `resend transport error: ${(cause as Error)?.message ?? "unknown"}`));
      }
    },
  };
}
