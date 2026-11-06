// Mailer + renderer tests — T17 (issue #17) acceptance: "Notification email
// renders for a completed submission (dev transport)"; no answer values ever
// leak into rendered emails or logs.
import { describe, expect, it } from "vitest";
import { createConsoleMailer } from "./console-mailer";
import { renderNotificationEmail, renderWebhookDisabledEmail, toMailMessage } from "./mailer";
import { createResendMailer } from "./resend-mailer";

// Answer values that must NEVER appear in any rendered email or log line.
const SECRET_ANSWER_VALUE = "hunter2-secret-answer";
const SECRET_ANSWER_EMAIL = "victim@example.com";

const completedInput = {
  documentTitle: "Contact form",
  documentId: "d1111111-1111-1111-1111-111111111111",
  submissionId: "s2222222-2222-2222-2222-222222222222",
  occurredAt: "2026-11-06T10:00:00.000Z",
  resultsUrl: "http://localhost:3000/documents/d1111111-1111-1111-1111-111111111111/submissions",
};

describe("renderNotificationEmail", () => {
  const rendered = renderNotificationEmail(completedInput);

  it("renders subject, text and html for a completed submission", () => {
    expect(rendered.subject).toBe("New submission — Contact form");
    expect(rendered.text).toContain(completedInput.submissionId);
    expect(rendered.text).toContain(completedInput.resultsUrl);
    expect(rendered.html).toContain("A new submission was completed.");
    expect(rendered.html).toContain(`href="${completedInput.resultsUrl}"`);
  });

  it("falls back to 'Untitled document' when the title is unknown", () => {
    const rendered2 = renderNotificationEmail({ ...completedInput, documentTitle: null });
    expect(rendered2.subject).toContain("Untitled document");
  });

  it("never contains answer values", () => {
    const blob = `${rendered.subject}\n${rendered.text}\n${rendered.html}`;
    expect(blob).not.toContain(SECRET_ANSWER_VALUE);
    expect(blob).not.toContain(SECRET_ANSWER_EMAIL);
  });

  it("escapes html in the document title", () => {
    const rendered3 = renderNotificationEmail({ ...completedInput, documentTitle: "<script>x</script>" });
    expect(rendered3.html).not.toContain("<script>x</script>");
    expect(rendered3.html).toContain("&lt;script&gt;");
  });
});

describe("renderWebhookDisabledEmail", () => {
  it("renders failure count and endpoint url without secrets", () => {
    const rendered = renderWebhookDisabledEmail({
      endpointUrl: "https://consumer.example.com/hook",
      documentTitle: "Contact form",
      consecutiveFailures: 10,
    });
    expect(rendered.subject).toContain("disabled");
    expect(rendered.text).toContain("10");
    expect(rendered.text).toContain("https://consumer.example.com/hook");
    expect(rendered.text).not.toContain("whsec_");
  });
});

describe("toMailMessage", () => {
  it("wraps a rendered email into a MailMessage", () => {
    const message = toMailMessage(renderNotificationEmail(completedInput), "owner@example.com");
    expect(message.to).toBe("owner@example.com");
    expect(message.subject).toBe("New submission — Contact form");
    expect(message.text).toBeDefined();
  });
});

describe("createConsoleMailer (dev transport)", () => {
  it("logs metadata and returns ok with an id", async () => {
    const lines: string[] = [];
    const mailer = createConsoleMailer({ log: (line) => lines.push(line), idFactory: () => "dev-fixed" });
    const result = await mailer.send(toMailMessage(renderNotificationEmail(completedInput), "owner@example.com"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("dev-fixed");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as { level: string; msg: string; to: string };
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("email.dev-transport");
    expect(parsed.to).toBe("owner@example.com");
  });

  it("never logs html/text bodies (answers must not leak)", async () => {
    const lines: string[] = [];
    const mailer = createConsoleMailer({ log: (line) => lines.push(line) });
    await mailer.send({
      to: "owner@example.com",
      subject: "New submission",
      html: `<p>${SECRET_ANSWER_VALUE}</p>`,
      text: SECRET_ANSWER_EMAIL,
    });
    const all = lines.join("\n");
    expect(all).not.toContain(SECRET_ANSWER_VALUE);
    expect(all).not.toContain(SECRET_ANSWER_EMAIL);
  });
});

describe("createResendMailer (behind injected fetch)", () => {
  const baseMessage = toMailMessage(renderNotificationEmail(completedInput), "owner@example.com");

  it("posts to /emails with bearer auth and returns the message id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "resend-123" }), { status: 200 });
    }) as typeof fetch;
    const mailer = createResendMailer({ apiKey: "re_test", from: "FormForge <noreply@formforge.dev>", fetchImpl });
    const result = await mailer.send(baseMessage);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("resend-123");
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.from).toBe("FormForge <noreply@formforge.dev>");
    expect(body.to).toBe("owner@example.com");
  });

  it("maps non-2xx responses to err(INTERNAL) without leaking the body", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 })) as typeof fetch;
    const mailer = createResendMailer({ apiKey: "re_test", from: "f@f.dev", fetchImpl });
    const result = await mailer.send({ ...baseMessage, html: SECRET_ANSWER_VALUE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(JSON.stringify(result.error)).not.toContain(SECRET_ANSWER_VALUE);
    }
  });

  it("maps network failures to err(INTERNAL)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const mailer = createResendMailer({ apiKey: "re_test", from: "f@f.dev", fetchImpl });
    const result = await mailer.send(baseMessage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("ECONNREFUSED");
  });
});
