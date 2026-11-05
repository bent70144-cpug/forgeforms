// Email job + contract parser tests — T17 (issue #17) acceptance:
// "Notification email renders for a completed submission (dev transport)."
import { describe, expect, it } from "vitest";
import { renderNotificationEmail, toMailMessage } from "@formforge/core/integrations";
import { processEmailJob } from "../src/jobs/email";
import { parseDeliverJobData, parseEmailJobData } from "../src/jobs/contracts";
import { makeDeps } from "./fakes";
import { completedEvent, DOCUMENT_ID, SECRET_ANSWER, SUBMISSION_ID } from "./fixtures";

const rendered = renderNotificationEmail({
  documentTitle: "Contact form",
  documentId: DOCUMENT_ID,
  submissionId: SUBMISSION_ID,
  occurredAt: "2026-11-06T10:00:00.000Z",
  resultsUrl: "http://localhost:3000/documents/x/submissions",
});

describe("processEmailJob (dev transport)", () => {
  it("sends via the console mailer and returns the message id", async () => {
    const harness = makeDeps();
    const result = await processEmailJob(
      harness.deps,
      "mail:notification:e1",
      {
        ...toMailMessage(rendered, "owner@example.com"),
        kind: "send-notification",
        meta: { eventId: "e1" },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("send-notification");
      expect(result.value.to).toBe("owner@example.com");
      expect(result.value.messageId).toMatch(/dev-/);
    }
  });

  it("propagates transport failures as err (BullMQ owns the retry)", async () => {
    const harness = makeDeps();
    harness.deps.mailer = {
      send: async () => ({ ok: false, error: { code: "INTERNAL", message: "resend down", name: "AppError" } as never }),
    };
    const result = await processEmailJob(harness.deps, "mail-1", {
      ...toMailMessage(rendered, "owner@example.com"),
      kind: "send-notification",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("resend down");
  });

  it("rejects malformed job data with VALIDATION", async () => {
    const harness = makeDeps();
    const result = await processEmailJob(harness.deps, "mail-1", { to: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });
});

describe("parseDeliverJobData", () => {
  it("accepts valid data with and without replay marker", () => {
    expect(parseDeliverJobData({ eventId: "e1", webhookId: "w1", attempt: 0 })).toEqual({
      ok: true,
      value: { eventId: "e1", webhookId: "w1", attempt: 0 },
    });
    expect(parseDeliverJobData({ eventId: "e1", webhookId: "w1", attempt: 2, replayOfDeliveryId: "d1" })).toEqual({
      ok: true,
      value: { eventId: "e1", webhookId: "w1", attempt: 2, replayOfDeliveryId: "d1" },
    });
  });

  it("rejects negative/non-integer attempts and missing ids", () => {
    expect(parseDeliverJobData({ eventId: "e1", webhookId: "w1", attempt: -1 }).ok).toBe(false);
    expect(parseDeliverJobData({ eventId: "e1", webhookId: "w1", attempt: 1.5 }).ok).toBe(false);
    expect(parseDeliverJobData({ webhookId: "w1", attempt: 0 }).ok).toBe(false);
    expect(parseDeliverJobData({ eventId: "e1", attempt: 0 }).ok).toBe(false);
    expect(parseDeliverJobData({ eventId: "e1", webhookId: "w1", attempt: 0, replayOfDeliveryId: "" }).ok).toBe(false);
  });
});

describe("parseEmailJobData", () => {
  it("accepts a rendered message and rejects missing fields", () => {
    const valid = parseEmailJobData({ to: "a@b.c", subject: "s", html: "<p>hi</p>", kind: "send-notification" });
    expect(valid.ok).toBe(true);
    expect(parseEmailJobData({ to: "a@b.c", kind: "x" }).ok).toBe(false);
    expect(parseEmailJobData({ to: "a@b.c", subject: "s", kind: "x" }).ok).toBe(false);
    expect(parseEmailJobData({ to: "a@b.c", subject: "s", html: "h" }).ok).toBe(false);
    expect(parseEmailJobData({ to: "a@b.c", subject: "s", html: "h", kind: "x", meta: 42 }).ok).toBe(false);
  });

  it("carries correlation meta but never answer values", () => {
    const parsed = parseEmailJobData({
      ...toMailMessage(rendered, "owner@example.com"),
      kind: "send-notification",
      meta: { eventId: "e1" },
    });
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.meta).toEqual({ eventId: "e1" });
    // Sanity: the fixture itself carries the secret; the email data must not.
    expect(completedEvent().data.answers.b1?.value).toBe(SECRET_ANSWER);
    expect(JSON.stringify(parsed.value)).not.toContain(SECRET_ANSWER);
  });
});
