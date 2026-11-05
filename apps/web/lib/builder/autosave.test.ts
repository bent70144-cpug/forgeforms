import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEnvelope } from "../bridge";
import { emptyBody, type Op } from "./ops";
import { AutosaveController, type AutosaveStatus } from "./autosave";
import { ConflictError, MockTransport, TransportError, seedEnvelope } from "./transport";

type Call = { baseRev: number; ops: readonly Op[] };

function env(overrides: Partial<DocumentEnvelope> = {}): DocumentEnvelope {
  return {
    id: "doc1",
    rev: 1,
    title: "Doc",
    status: "draft",
    type: "form",
    body: emptyBody("form"),
    ...overrides,
  };
}

/** Records calls and delegates each patch to the next queued behavior. */
function recordedTransport(
  start: DocumentEnvelope,
  behaviors: Array<(call: Call, n: number) => Promise<{ rev: number }> | { rev: number }>,
) {
  const patches: Call[] = [];
  let loads = 0;
  const transport = {
    load: vi.fn(async () => {
      loads += 1;
      return structuredClone(start);
    }),
    patch: vi.fn(async (docId: string, baseRev: number, ops: readonly Op[]) => {
      const n = patches.length;
      patches.push({ baseRev, ops });
      const behavior = behaviors[n];
      if (!behavior) throw new Error(`unexpected patch call #${n + 1}`);
      return behavior({ baseRev, ops }, n);
    }),
  };
  return {
    transport,
    patches,
    loadCount: () => loads,
  };
}

describe("AutosaveController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function collector() {
    const statuses: AutosaveStatus[] = [];
    const acks: number[] = [];
    return {
      statuses,
      acks,
      onStatus: (s: AutosaveStatus) => void statuses.push(s),
      onAck: (rev: number) => void acks.push(rev),
    };
  }

  it("debounces a burst of enqueues into a single PATCH", async () => {
    const { transport, patches } = recordedTransport(env(), [() => ({ rev: 2 })]);
    const c = collector();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
    });

    const op = (i: number): Op => ({ op: "meta.update", patch: { title: `t${i}` } });
    controller.enqueue([op(1)]);
    controller.enqueue([op(2)]);
    await vi.advanceTimersByTimeAsync(200); // inside the debounce window
    controller.enqueue([op(3)]);
    await vi.advanceTimersByTimeAsync(500); // 200 < 500 → timer reset by third enqueue

    expect(patches.length).toBe(1);
    expect(patches[0]?.baseRev).toBe(1);
    expect(patches[0]?.ops.length).toBe(3);
    expect(c.statuses).toContain("saved");
    expect(c.acks).toEqual([2]);
    controller.destroy();
  });

  it("serializes: ops enqueued during an in-flight flush go out in the next batch", async () => {
    let resolveFirst!: (v: { rev: number }) => void;
    const first = new Promise<{ rev: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const { transport, patches } = recordedTransport(env(), [() => first, () => ({ rev: 3 })]);
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport,
      docId: "doc1",
      initialRev: 1,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "a" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(patches.length).toBe(1);

    // User keeps editing while patch #1 is in flight.
    controller.enqueue([{ op: "meta.update", patch: { title: "b" } }]);
    await vi.advanceTimersByTimeAsync(500); // debounce fires; flush must be single-flight
    expect(patches.length).toBe(1);

    resolveFirst({ rev: 2 });
    await vi.advanceTimersByTimeAsync(0);

    expect(patches.length).toBe(2);
    expect(patches[1]?.baseRev).toBe(2);
    expect(patches[1]?.ops).toEqual([{ op: "meta.update", patch: { title: "b" } }]);
    controller.destroy();
  });

  it("recovers from 409: reloads, replays ops on the fresh body, re-sends with the fresh rev", async () => {
    const fresh = env({ rev: 5, body: { ...emptyBody("form"), blocks: [{ id: "a", kind: "text", props: {} }] } });
    const { transport, patches, loadCount } = recordedTransport(fresh, [
      () => {
        throw new ConflictError(5, "stale");
      },
      () => ({ rev: 6 }),
    ]);
    const c = collector();
    const reconciled: Array<{ rev: number; title: string; blocks: unknown[] }> = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onReconciled: (doc, rev) => {
        reconciled.push({ rev, title: doc.meta.title, blocks: doc.body.blocks });
      },
    });

    controller.enqueue([{ op: "block.update", id: "a", props: { label: "Local edit" } }]);
    await vi.advanceTimersByTimeAsync(500);

    expect(loadCount()).toBe(1);
    expect(c.statuses).toContain("conflict");
    expect(patches.length).toBe(2);
    expect(patches[1]?.baseRev).toBe(5); // re-sent against the server's rev
    expect(patches[1]?.ops).toEqual([{ op: "block.update", id: "a", props: { label: "Local edit" } }]);
    expect(reconciled.length).toBe(1);
    expect(reconciled[0]?.rev).toBe(5);
    expect((reconciled[0]?.blocks as Array<{ id: string; props: Record<string, unknown> }>)[0]?.props.label).toBe(
      "Local edit",
    );
    expect(c.acks).toEqual([5, 6]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    expect(controller.currentRev).toBe(6);
    controller.destroy();
  });

  it("keeps ops enqueued during 409 recovery and sends them after re-ack", async () => {
    let resolveGate!: (v: DocumentEnvelope) => void;
    const loadGate = new Promise<DocumentEnvelope>((resolve) => {
      resolveGate = resolve;
    });
    let patchCalls = 0;
    const patches: Call[] = [];
    const transport = {
      load: vi.fn(() => loadGate),
      patch: vi.fn(async (_docId: string, baseRev: number, ops: readonly Op[]) => {
        patches.push({ baseRev, ops });
        patchCalls += 1;
        if (patchCalls === 1) throw new ConflictError(4, "stale");
        return { rev: baseRev + 1 };
      }),
    };
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport,
      docId: "doc1",
      initialRev: 1,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "first" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(patchCalls).toBe(1);

    // Editing continues while recovery's load() is hanging.
    controller.enqueue([{ op: "meta.update", patch: { title: "second" } }]);

    resolveGate(env({ rev: 4 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(patches.length).toBe(2);
    expect(patches[1]?.baseRev).toBe(4);
    expect(patches[1]?.ops.map((o) => (o.op === "meta.update" ? o.patch.title : "?"))).toEqual([
      "first",
      "second",
    ]);
    controller.destroy();
  });

  it("drops ops whose targets no longer exist on the server (recovery)", async () => {
    const fresh = env({ rev: 7 });
    const { transport, patches } = recordedTransport(fresh, [
      () => {
        throw new ConflictError(7, "stale");
      },
      () => ({ rev: 8 }),
    ]);
    const reconciled: Array<{ droppedCount: number }> = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onReconciled: (_doc, _rev, droppedCount) => reconciled.push({ droppedCount }),
    });

    controller.enqueue([
      { op: "block.update", id: "ghost", props: { label: "gone" } }, // will be dropped
      { op: "meta.update", patch: { title: "kept" } },
    ]);
    await vi.advanceTimersByTimeAsync(500);

    expect(reconciled[0]?.droppedCount).toBe(1);
    expect(patches[1]?.ops).toEqual([{ op: "meta.update", patch: { title: "kept" } }]);
    controller.destroy();
  });

  it("retries transient errors with backoff, then succeeds", async () => {
    let calls = 0;
    const { transport, patches } = recordedTransport(env(), [
      () => {
        calls += 1;
        throw new TransportError("INTERNAL", "boom", 500);
      },
      () => {
        calls += 1;
        throw new TransportError("INTERNAL", "boom", 502);
      },
      () => ({ rev: 2 }),
    ]);
    const c = collector();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500); // first attempt fails
    await vi.advanceTimersByTimeAsync(500); // backoff 1 → second attempt fails
    await vi.advanceTimersByTimeAsync(1000); // backoff 2 → third attempt succeeds
    expect(patches.length).toBe(3); // 2 failed attempts + 1 success
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    controller.destroy();
  });

  it("surfaces an error after maxRetries and keeps the ops queued", async () => {
    const { transport } = recordedTransport(env(), [
      () => {
        throw new TransportError("NETWORK", "offline");
      },
      () => {
        throw new TransportError("NETWORK", "offline");
      },
      () => {
        throw new TransportError("NETWORK", "offline");
      },
      () => {
        throw new TransportError("NETWORK", "offline");
      },
    ]);
    const c = collector();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500 + 500 + 1000 + 2000);
    expect(c.statuses).toContain("error");
    expect(controller.pendingCount).toBe(1);
    controller.destroy();
  });

  it("reports 'saved' within 2s of the last change (M2 acceptance)", async () => {
    const { transport } = recordedTransport(env(), [() => ({ rev: 2 })]);
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport,
      docId: "doc1",
      initialRev: 1,
    });

    const t0 = Date.now();
    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(700); // 500 debounce + roundtrip
    const elapsed = (controller.lastSavedAt ?? Number.POSITIVE_INFINITY) - t0;
    expect(elapsed).toBeLessThanOrEqual(2000);
    controller.destroy();
  });

  it("ignores enqueues after destroy", async () => {
    const { transport, patches } = recordedTransport(env(), [() => ({ rev: 2 })]);
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
    });
    controller.destroy();
    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(patches.length).toBe(0);
  });
});

describe("MockTransport", () => {
  it("applies ops and increments rev", async () => {
    const mock = new MockTransport({ latencyMs: 0, seed: [seedEnvelope("doc1")] });
    const res = await mock.patch("doc1", 1, [{ op: "meta.update", patch: { title: "Renamed" } }]);
    expect(res.rev).toBe(2);
    const doc = await mock.load("doc1");
    expect(doc.title).toBe("Renamed");
  });

  it("throws ConflictError with the current rev when baseRev is stale", async () => {
    const mock = new MockTransport({ latencyMs: 0, seed: [seedEnvelope("doc1")] });
    mock.bumpRev("doc1"); // simulated concurrent writer
    await expect(mock.patch("doc1", 1, [{ op: "meta.update", patch: { title: "x" } }])).rejects.toThrowError(
      ConflictError,
    );
    try {
      await mock.patch("doc1", 1, []);
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).rev).toBe(2);
    }
  });

  it("returns VALIDATION (422) for invalid ops", async () => {
    const mock = new MockTransport({ latencyMs: 0, seed: [seedEnvelope("doc1")] });
    await expect(mock.patch("doc1", 1, [{ op: "block.remove", id: "ghost" }])).rejects.toMatchObject({
      code: "VALIDATION",
      status: 422,
    });
  });

  it("publishes a draft", async () => {
    const mock = new MockTransport({ latencyMs: 0, seed: [seedEnvelope("doc1")] });
    await expect(mock.publish?.("doc1")).resolves.toEqual({ status: "published" });
  });
});
