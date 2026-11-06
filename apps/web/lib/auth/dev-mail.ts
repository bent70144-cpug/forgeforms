// Dev email transport (ticket #5 acceptance: "dev transport", "Dev email
// transport logs to console when RESEND_API_KEY unset").
//
// Composition: console logger (the @formforge/core console mailer — metadata
// only, never message bodies, per the spec §4 logging rule) plus an OPTIONAL
// local file outbox for end-to-end tests. The file sink is off unless
// DEV_MAIL_OUTBOX points at a directory AND the code runs outside production —
// E2E tests read the JSON lines there to follow the emailed reset link (the
// Playwright suite cannot reach server stdout).
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createConsoleMailer } from "@formforge/core/integrations";
import type { Mailer, MailMessage, MailSendResult } from "@formforge/core/integrations";
import { type AppError, type Result } from "@formforge/core";;

export type DevMailerOptions = {
  /** Directory for the E2E outbox; enables the file sink when set. */
  outboxDir?: string;
  /** Injectable for tests. */
  now?: () => Date;
  /** Injectable for tests (defaults to real fs appends). */
  appendLine?: (path: string, line: string) => void;
};

type OutboxMessage = MailMessage & { sentAt: string };

/** True when the local E2E outbox should be active. Never in production. */
export function devOutboxEnabled(outboxDir: string | undefined): outboxDir is string {
  return (
    typeof outboxDir === "string" &&
    outboxDir.length > 0 &&
    process.env.NODE_ENV !== "production"
  );
}

export function createDevMailer(options: DevMailerOptions = {}): Mailer {
  const consoleMailer = createConsoleMailer();
  const appendLine = options.appendLine ?? defaultAppend;
  const now = options.now ?? (() => new Date());
  const outboxDir = devOutboxEnabled(options.outboxDir) ? options.outboxDir : null;

  return {
    async send(message: MailMessage): Promise<Result<MailSendResult, AppError>> {
      // Dev acceptance: logs to console when RESEND_API_KEY is unset.
      const result = await consoleMailer.send(message);
      if (outboxDir !== null && result.ok) {
        const line: OutboxMessage = { ...message, sentAt: now().toISOString() };
        appendLine(join(outboxDir, "dev-emails.jsonl"), JSON.stringify(line));
      }
      return result;
    },
  };
}

function defaultAppend(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${line}\n`, "utf8");
}

/** Pull the first matching URL out of a captured dev-transport message (tests). */
export function extractUrlFromDevMessage(message: { html: string; text?: string }, regex: RegExp): string | null {
  for (const source of [message.text ?? "", message.html]) {
    const match = regex.exec(source);
    if (match?.[0]) return match[0];
  }
  return null;
}
