// Dev email transport (ticket #5 acceptance: "Dev email transport logs to
// console when RESEND_API_KEY unset") + E2E outbox file sink.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevMailer, devOutboxEnabled, extractUrlFromDevMessage } from "@/lib/auth/dev-mail";

const RESET_LINK_RE = /\/reset-password\?token=[A-Za-z0-9_-]+/;

function sampleMessage() {
  return {
    to: "ana@example.com",
    subject: "Reset your FormForge password",
    html: "<p><a href=\"https://x.test/reset-password?token=abcDEF123\">reset</a></p>",
    text: "Reset link: https://x.test/reset-password?token=abcDEF123",
  };
}

describe("createDevMailer", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("logs a metadata-only console line per send (never the body)", async () => {
    const logLines: string[] = [];
    const mailer = createDevMailer();
    // createDevMailer wraps createConsoleMailer, which logs via console.log.
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logLines.push(String(line));
    });

    const result = await mailer.send(sampleMessage());

    expect(result.ok).toBe(true);
    expect(logLines).toHaveLength(1);
    const parsed = JSON.parse(logLines[0]!) as { msg: string; to: string; subject: string };
    expect(parsed.msg).toBe("email.dev-transport");
    expect(parsed.to).toBe("ana@example.com");
    expect(logLines[0]).not.toContain("reset-password?token="); // body never logged
    spy.mockRestore();
  });

  it("appends the full message to the outbox when DEV_MAIL_OUTBOX is set (E2E)", async () => {
    const outboxDir = mkdtempSync(join(tmpdir(), "ff-dev-mail-"));
    tempDirs.push(outboxDir);
    const mailer = createDevMailer({ outboxDir });

    await mailer.send(sampleMessage());
    await mailer.send(sampleMessage());

    const lines = readFileSync(join(outboxDir, "dev-emails.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]!) as { to: string; html: string; text: string };
    expect(parsed.to).toBe("ana@example.com");
    expect(parsed.text).toContain("token=abcDEF123");
    const url = extractUrlFromDevMessage(parsed, /https:\/\/x\.test\/reset-password\?token=[A-Za-z0-9_-]+/);
    expect(url).toBe("https://x.test/reset-password?token=abcDEF123");
  });

  it("never enables the outbox in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      expect(devOutboxEnabled("/tmp/outbox")).toBe(false);
      expect(devOutboxEnabled(undefined)).toBe(false);
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
