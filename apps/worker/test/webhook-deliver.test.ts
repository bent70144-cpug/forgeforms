// Webhook deliver job tests — T17 (issue #17) acceptance:
//   - failing endpoint retried on the EXACT backoff schedule (1m/5m/30m/2h/12h),
//     every attempt visible in the delivery log;
//   - signature verified by a test consumer (round-trip through the signer);
//   - after 10 consecutive failures the endpoint auto-disables + owner notified.
import { describe, expect, it } from "vitest";
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  serializeWebhookBody,
} from "@formforge/core/integrations";
import { processWebhookDeliver } from "../src/jobs/webhook-deliver";
import { JOBS, QUEUES } from "../src/queues/names";
import { makeDeps } from "./fakes";
import { completedEvent, endpoint, EVENT_ID, SECRET_ANSWER } from "./fixtures";

const EXACT_SCHEDULE_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

describe("processWebhookDeliver", () => {
  it("delivers a signed POST, records the attempt, and does not reschedule on success", async () => {
    const harness = makeDeps();
    const ep = endpoint();
    harness.webhooks.seedEndpoint(ep);
    await harness.events.insertEventOnce({
      id: EVENT_ID,
      workspaceId: ep.workspaceId,
      type: "submission.completed",
      documentId: ep.documentId,
      payload: completedEvent(),
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });

    const result = await processWebhookDeliver(harness.deps, "job-1", {
      eventId: EVENT_ID,
      webhookId: ep.id,
      attempt: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ delivered: true, attempt: 0, statusCode: 200 });

    // One HTTP POST with the right shape.
    expect(harness.post.requests).toHaveLength(1);
    const request = harness.post.requests[0];
    expect(request?.url).toBe(ep.url);
    expect(request?.body).toBe(serializeWebhookBody(completedEvent()));
    expect(request?.headers["Content-Type"]).toBe("application/json");
    expect(request?.headers[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // Test consumer verifies the signature over the EXACT bytes received.
    const verification = verifyWebhookSignature({
      header: request?.headers[WEBHOOK_SIGNATURE_HEADER] ?? "",
      secret: ep.secret,
      body: request?.body ?? "",
      nowSeconds: Math.floor(harness.clock.now().getTime() / 1000),
    });
    expect(verification.ok).toBe(true);

    // Tampered body is rejected by the consumer.
    const tampered = (request?.body ?? "").replace(EVENT_ID, "00000000-0000-4000-8000-00000000dead");
    expect(
      verifyWebhookSignature({
        header: request?.headers[WEBHOOK_SIGNATURE_HEADER] ?? "",
        secret: ep.secret,
        body: tampered,
        nowSeconds: Math.floor(harness.clock.now().getTime() / 1000),
      }),
    ).toEqual({ ok: false, reason: "mismatch" });

    // Attempt recorded in the delivery log.
    const deliveries = await harness.webhooks.listDeliveries(ep.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ attempt: 0, ok: true, statusCode: 200, durationMs: expect.any(Number) });

    // No retry scheduled on success.
    expect(harness.queue.jobsFor(QUEUES.webhooks)).toHaveLength(0);
  });

  it("never leaks answer values or secrets into logs", async () => {
    const harness = makeDeps();
    const ep = endpoint();
    harness.webhooks.seedEndpoint(ep);
    await harness.events.insertEventOnce({
      id: EVENT_ID,
      workspaceId: ep.workspaceId,
      type: "submission.completed",
      documentId: ep.documentId,
      payload: completedEvent(),
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });
    harness.post.setNext({ ok: false, status: 500 });

    await processWebhookDeliver(harness.deps, "job-1", { eventId: EVENT_ID, webhookId: ep.id, attempt: 0 });

    const allLogs = harness.logs.join("\n");
    expect(allLogs).not.toContain(SECRET_ANSWER);
    expect(allLogs).not.toContain(ep.secret);
  });

  it("retries on the EXACT schedule 1m/5m/30m/2h/12h, logging every attempt", async () => {
    const harness = makeDeps();
    const ep = endpoint();
    harness.webhooks.seedEndpoint(ep);
    await harness.events.insertEventOnce({
      id: EVENT_ID,
      workspaceId: ep.workspaceId,
      type: "submission.completed",
      documentId: ep.documentId,
      payload: completedEvent(),
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });
    harness.post.setNext({ ok: false, status: 500 });

    // Drive the full chain attempt 0 → 5.
    for (let attempt = 0; attempt <= 5; attempt += 1) {
      const result = await processWebhookDeliver(harness.deps, `job-${attempt}`, {
        eventId: EVENT_ID,
        webhookId: ep.id,
        attempt,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      if (attempt < 5) {
        expect(result.value).toEqual({
          retryScheduled: true,
          attempt,
          nextAttempt: attempt + 1,
          delayMs: EXACT_SCHEDULE_MS[attempt],
        });
      } else {
        expect(result.value).toEqual({ exhausted: true, attempt: 5, consecutiveFailures: expect.any(Number) });
      }
    }

    // Delivery log: one row per attempt, all failures, attempts 0..5.
    const deliveries = await harness.webhooks.listDeliveries(ep.id);
    expect(deliveries).toHaveLength(6);
    expect(deliveries.map((d) => d.attempt).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(deliveries.every((d) => !d.ok)).toBe(true);

    // The chain scheduled exactly the five retries with exact delays.
    const enqueued = harness.queue.jobsFor(QUEUES.webhooks, JOBS.deliver);
    expect(enqueued.map((job) => job.options?.delayMs)).toEqual(EXACT_SCHEDULE_MS);
    expect(enqueued.map((job) => (job.data as { attempt: number }).attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it("auto-disables the endpoint after 10 consecutive failures and notifies the owner", async () => {
    const harness = makeDeps();
    const ep = endpoint();
    harness.webhooks.seedEndpoint(ep);
    await harness.events.insertEventOnce({
      id: EVENT_ID,
      workspaceId: ep.workspaceId,
      type: "submission.completed",
      documentId: ep.documentId,
      payload: completedEvent(),
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });
    // Nine consecutive failures already recorded for this endpoint.
    await harness.webhooks.seedDeliveries(ep.id, [false, false, false, false, false, false, false, false, false]);
    harness.post.setNext({ ok: false, status: 503 });

    const result = await processWebhookDeliver(harness.deps, "job-1", {
      eventId: EVENT_ID,
      webhookId: ep.id,
      attempt: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ disabled: true, attempt: 2, consecutiveFailures: 10, ownerNotified: true });

    const stored = await harness.webhooks.getEndpoint(ep.id);
    expect(stored?.enabled).toBe(false);
    expect(harness.webhooks.disabledCalls).toBe(1);

    // Owner notification email enqueued (no retry scheduled after disable).
    const emails = harness.queue.jobsFor(QUEUES.email, JOBS.sendNotification);
    expect(emails).toHaveLength(1);
    const emailData = emails[0]?.data as { to: string; subject: string; kind: string };
    expect(emailData.to).toBe("owner@example.com");
    expect(emailData.subject).toContain("disabled");
    expect(emails[0]?.options?.jobId).toBe(`mail:wh-disabled:${ep.id}:${EVENT_ID}`);
    expect(harness.queue.jobsFor(QUEUES.webhooks)).toHaveLength(0);
  });

  it("skips disabled endpoints without POSTing or logging an attempt", async () => {
    const harness = makeDeps();
    const ep = endpoint({ enabled: false });
    harness.webhooks.seedEndpoint(ep);
    await harness.events.insertEventOnce({
      id: EVENT_ID,
      workspaceId: ep.workspaceId,
      type: "submission.completed",
      documentId: ep.documentId,
      payload: completedEvent(),
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });

    const result = await processWebhookDeliver(harness.deps, "job-1", {
      eventId: EVENT_ID,
      webhookId: ep.id,
      attempt: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ skipped: true, reason: "endpoint-disabled" });
    expect(harness.post.requests).toHaveLength(0);
    expect(await harness.webhooks.listDeliveries(ep.id)).toHaveLength(0);
  });

  it("skips endpoints that are not subscribed to the event type", async () => {
    const harness = makeDeps();
    const ep = endpoint({ events: ["submission.spam"] });
    harness.webhooks.seedEndpoint(ep);
    await harness.events.insertEventOnce({
      id: EVENT_ID,
      workspaceId: ep.workspaceId,
      type: "submission.completed",
      documentId: ep.documentId,
      payload: completedEvent(),
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });

    const result = await processWebhookDeliver(harness.deps, "job-1", {
      eventId: EVENT_ID,
      webhookId: ep.id,
      attempt: 0,
    });

    if (!result.ok) throw result.error;
    expect(result.value).toEqual({ skipped: true, reason: "not-subscribed" });
    expect(harness.post.requests).toHaveLength(0);
  });

  it("returns NOT_FOUND when the event does not exist", async () => {
    const harness = makeDeps();
    const ep = endpoint();
    harness.webhooks.seedEndpoint(ep);

    const result = await processWebhookDeliver(harness.deps, "job-1", {
      eventId: "00000000-0000-4000-8000-00000000dead",
      webhookId: ep.id,
      attempt: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
