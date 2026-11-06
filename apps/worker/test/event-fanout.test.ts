// Fan-out routing tests — T17 (issue #17): on submission.completed notify the
// document owner (email) AND deliver to each active webhook endpoint; the
// event is persisted exactly once; one failing webhook never blocks others.
import { describe, expect, it } from "vitest";
import { processEventFanout } from "../src/jobs/event-fanout";
import { webhookDeliverJobId } from "../src/jobs/event-fanout";
import { JOBS, QUEUES } from "../src/queues/names";
import { makeDeps, type TestHarness } from "./fakes";
import { completedEvent, DOCUMENT_ID, endpoint, EVENT_ID, SECRET_ANSWER, WORKSPACE_ID } from "./fixtures";

function seedEndpoints(harness: TestHarness): { active: string[]; all: string[] } {
  const docEndpoint = endpoint();
  const workspaceWide = endpoint({ documentId: null });
  const otherDocument = endpoint({ documentId: "00000000-0000-4000-8000-999999999999" });
  const disabled = endpoint({ enabled: false });
  const unsubscribed = endpoint({ events: ["submission.spam"] });
  for (const e of [docEndpoint, workspaceWide, otherDocument, disabled, unsubscribed]) {
    harness.webhooks.seedEndpoint(e);
  }
  return {
    active: [docEndpoint.id, workspaceWide.id],
    all: [docEndpoint.id, workspaceWide.id, otherDocument.id, disabled.id, unsubscribed.id],
  };
}

describe("processEventFanout", () => {
  it("persists the event exactly once and skips redeliveries", async () => {
    const harness = makeDeps();
    seedEndpoints(harness); // 2 active endpoints → 2 deliver jobs on first run
    const event = completedEvent();

    const first = await processEventFanout(harness.deps, structuredClone(event));
    expect(first.ok).toBe(true);
    const second = await processEventFanout(harness.deps, structuredClone(event));

    expect(harness.events.rows.size).toBe(1);
    expect(harness.events.insertCalls).toBe(2);
    if (first.ok && second.ok) {
      expect(first.value.eventCreated).toBe(true);
      expect(second.value.skipped).toBe("already-processed");
    } else {
      expect.unreachable();
    }
    // No duplicate side effects on redelivery.
    expect(harness.queue.jobsFor(QUEUES.email)).toHaveLength(1);
    expect(harness.queue.jobsFor(QUEUES.webhooks)).toHaveLength(2);
  });

  it("routes notification email + N webhooks, ignoring disabled/unsubscribed/foreign endpoints", async () => {
    const harness = makeDeps();
    const { active, all } = seedEndpoints(harness);

    const result = await processEventFanout(harness.deps, completedEvent());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Email: exactly one, rendered for the owner, no answer values.
    const emails = harness.queue.jobsFor(QUEUES.email, JOBS.sendNotification);
    expect(emails).toHaveLength(1);
    const emailData = emails[0]?.data as { to: string; subject: string; html: string; text: string; kind: string };
    expect(emailData.kind).toBe("send-notification");
    expect(emailData.to).toBe("owner@example.com");
    expect(emailData.subject).toContain("Contact form");
    expect(`${emailData.html}${emailData.text}`).not.toContain(SECRET_ANSWER);
    expect(emails[0]?.options?.jobId).toBe(`mail:notification:${EVENT_ID}`);

    // Webhooks: only active + subscribed + matching document (or workspace-wide).
    const deliveries = harness.queue.jobsFor(QUEUES.webhooks, JOBS.deliver);
    expect(deliveries.map((job) => (job.data as { webhookId: string }).webhookId).sort()).toEqual([...active].sort());
    for (const job of deliveries) {
      expect(job.data).toEqual({ eventId: EVENT_ID, webhookId: (job.data as { webhookId: string }).webhookId, attempt: 0 });
      expect(job.options?.jobId).toBe(webhookDeliverJobId((job.data as { webhookId: string }).webhookId, EVENT_ID, 0));
    }
    expect(result.value.webhooksEnqueued).toBe(active.length);
    expect(result.value.emailEnqueued).toBe(true);
    expect(all.length).toBe(5); // sanity: five endpoints were seeded

    // Event marked processed.
    const row = await harness.events.getEvent(EVENT_ID);
    expect(row?.processedAt).not.toBeNull();
  });

  it("keeps routing when one webhook enqueue fails (isolation)", async () => {
    const harness = makeDeps();
    const a = endpoint();
    const b = endpoint();
    harness.webhooks.seedEndpoint(a);
    harness.webhooks.seedEndpoint(b);
    harness.queue.failEnqueue(QUEUES.webhooks, webhookDeliverJobId(a.id, EVENT_ID, 0));

    const result = await processEventFanout(harness.deps, completedEvent());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.webhooksEnqueued).toBe(1); // b still went out
    expect(result.value.webhookEnqueueFailures).toBe(1); // a failed, isolated
    expect(result.value.emailEnqueued).toBe(true); // email unaffected
    const enqueuedIds = harness
      .queue.jobsFor(QUEUES.webhooks)
      .map((job) => (job.data as { webhookId: string }).webhookId);
    expect(enqueuedIds).toEqual([b.id]);
  });

  it("still processes when there is no notification target", async () => {
    const harness = makeDeps({ notificationTarget: null });
    harness.webhooks.seedEndpoint(endpoint());

    const result = await processEventFanout(harness.deps, completedEvent());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.emailEnqueued).toBe(false);
    expect(result.value.webhooksEnqueued).toBe(1);
    expect(harness.queue.jobsFor(QUEUES.email)).toHaveLength(0);
  });

  it("rejects malformed payloads with VALIDATION", async () => {
    const harness = makeDeps();
    const result = await processEventFanout(harness.deps, { nope: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(harness.events.rows.size).toBe(0);
  });

  it("scopes queries by workspace (spec §3)", async () => {
    const harness = makeDeps();
    harness.webhooks.seedEndpoint(endpoint({ workspaceId: "00000000-0000-4000-8000-ffffffffffff" }));
    const result = await processEventFanout(harness.deps, completedEvent());
    if (!result.ok) throw result.error;
    expect(result.value.webhooksEnqueued).toBe(0);
    expect(WORKSPACE_ID).toBeDefined();
    expect(DOCUMENT_ID).toBeDefined();
  });
});
