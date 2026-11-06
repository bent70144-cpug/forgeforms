// Console (dev) mailer — used when RESEND_API_KEY is not configured so the
// local dev loop (`docker compose up -d && pnpm dev`) still delivers emails
// visibly. Logs metadata only: never subject content that could embed answer
// values, never the html/text bodies.
import { AppError } from "../shared/errors.ts";
import { ok, type Result } from "../shared/result.ts";
import type { MailMessage, Mailer, MailSendResult } from "./mailer";

export type ConsoleMailerConfig = {
  /** Injectable sink for tests. Defaults to console.log with one JSON line. */
  log?: (line: string) => void;
  /** Injectable id factory for deterministic tests. */
  idFactory?: () => string;
};

export function createConsoleMailer(config: ConsoleMailerConfig = {}): Mailer {
  const log = config.log ?? ((line: string) => console.log(line));
  let counter = 0;
  const idFactory = config.idFactory ?? (() => `dev-${(counter += 1)}`);
  return {
    async send(message: MailMessage): Promise<Result<MailSendResult, AppError>> {
      log(
        JSON.stringify({
          level: "info",
          msg: "email.dev-transport",
          to: message.to,
          subject: message.subject,
        }),
      );
      return ok({ id: idFactory() });
    },
  };
}
