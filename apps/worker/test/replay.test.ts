// Replay service tests — T17 (issue #17) acceptance: "Replay re-delivers and
// logs a new attempt."
import { describe, expect, it } from "vitest";
import { parseDeliverJobId, replayDelivery, replayJob } from "../src/jobs/replay";
import { processWebhookDeliver } from "../src/jobs/webhook-deliver";
import { JOBS, QUEUES } from "../src/queues/names";
import { makeDeps } from "./fakes";
import { completedEvent, endpoint, EVENT_ID } from "./fixtures";

async function seedSuccessfulDelivery() {
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
  const first = await processWebhookDeliver(harness.deps, "job-0", {
    eventId: EVENT_ID,
    webhookId: ep.id,
    attempt: 0,
  });
  if (!first.ok) throw first.error;
  const deliveries = await harness.webhooks.listDeliveries(ep.id);
  return { harness, ep, delivery: deliveries[0] as NonNullable<(typeof deliveries)[number]> };
}

describe("replayDelivery", () => {
  it("enqueues a NEW deliver job for the recorded attempt and logs a new row on execution", async () => {
    const { harness, ep, delivery } = await seedSuccessfulDelivery();

    const result = await replayDelivery(harness.deps, delivery.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempt).toBe(delivery.attempt);
    expect(result.value.jobId).toBe(`wh:${ep.id}:${EVENT_ID}:a${delivery.attempt}:r${delivery.id}`);

    const replayJobs = harness.queue.jobsFor(QUEUES.webhooks, JOBS.deliver);
    expect(replayJobs).toHaveLength(1);
    expect(replayJobs[0]?.data).toEqual({
      eventId: EVENT_ID,
      webhookId: ep.id,
      attempt: delivery.attempt,
      replayOfDeliveryId: delivery.id,
    });

    // Executing the replay job POSTs again and records ANOTHER attempt row.
    const executed = await processWebhookDeliver(harness.deps, result.value.jobId, replayJobs[0]?.data);
    if (!executed.ok) throw executed.error;
    expect(executed.value).toEqual({ delivered: true, attempt: delivery.attempt, statusCode: 200 });
    const deliveries = await harness.webhooks.listDeliveries(ep.id);
    expect(deliveries).toHaveLength(2); // original + replay — new row, new timestamp
    expect(new Set(deliveries.map((d) => d.id)).size).toBe(2);
  });

  it("returns NOT_FOUND for an unknown delivery", async () => {
    const harness = makeDeps();
    const result = await replayDelivery(harness.deps, "00000000-0000-4000-8000-00000000dead");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("replayJob", () => {
  it("replays the latest delivery when given an original chain job id", async () => {
    const { harness, ep, delivery } = await seedSuccessfulDelivery();

    const result = await replayJob(harness.deps, `wh:${ep.id}:${EVENT_ID}:a0`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.jobId).toBe(`wh:${ep.id}:${EVENT_ID}:a0:r${delivery.id}`);
  });

  it("replays the exact delivery when given a replay job id", async () => {
    const { harness, ep, delivery } = await seedSuccessfulDelivery();

    const result = await replayJob(harness.deps, `wh:${ep.id}:${EVENT_ID}:a0:r${delivery.id}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.jobId).toBe(`wh:${ep.id}:${EVENT_ID}:a0:r${delivery.id}`);
  });

  it("rejects ids that are not deliver job ids", async () => {
    const harness = makeDeps();
    expect(parseDeliverJobId("mail:notification:evt-1").ok).toBe(false);
    expect(parseDeliverJobId("wh:only:two").ok).toBe(false);
    expect(parseDeliverJobId("wh:webhook:event:x1").ok).toBe(false);
    const parsed = parseDeliverJobId("wh:webhook:event:a3:r9f2");
    expect(parsed).toEqual({
      ok: true,
      value: { webhookId: "webhook", eventId: "event", attempt: 3, replayOfDeliveryId: "9f2" },
    });
    const bad = await replayJob(harness.deps, "totally-different");
    expect(bad.ok).toBe(false);
  });
});
