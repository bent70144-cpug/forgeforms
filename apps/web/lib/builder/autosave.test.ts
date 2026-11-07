import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEnvelope } from "../bridge";
import { emptyBody, type Op } from "./ops";
import {
  AutosaveController,
  type AutosaveStatus,
  type ConflictEvent,
  type OpRejectedEvent,
  type PlanLimitEvent,
  type RebasedEvent,
} from "./autosave";
import { ConflictError, ForbiddenError, MockTransport, OpRejectedError, PlanLimitError, TransportError, UnauthenticatedError, seedEnvelope } from "./transport";
import type { OfflineQueuePort, PendingBatchRecord } from "./offline";

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

function fakeQueue() {
  const saved: PendingBatchRecord[] = [];
  const cleared: string[] = [];
  const port: OfflineQueuePort = {
    saveQueue: (record) => void saved.push(record),
    loadQueue: async (docId) => saved.find((r) => r.docId === docId) ?? null,
    clearQueue: async (docId) => void cleared.push(docId),
  };
  return { saved, cleared, port };
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

  it("flushes after the 5s max wait under continuous typing (§7.1)", async () => {
    const { transport, patches } = recordedTransport(env(), [() => ({ rev: 2 })]);
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
    });

    const op = (i: number): Op => ({ op: "meta.update", patch: { title: `t${i}` } });
    controller.enqueue([op(1)]);
    for (let i = 2; i <= 13; i++) {
      await vi.advanceTimersByTimeAsync(400); // debounce (500ms) never settles
      controller.enqueue([op(i)]);
    }
    await vi.advanceTimersByTimeAsync(199); // t=4999 — still waiting
    expect(patches.length).toBe(0);

    await vi.advanceTimersByTimeAsync(1); // t=5000 — max wait reached
    expect(patches.length).toBe(1);
    expect(patches[0]?.baseRev).toBe(1);
    expect(patches[0]?.ops.length).toBe(13);
    controller.destroy();
  });

  it("flushNow() bypasses the debounce (Cmd+S / pagehide)", async () => {
    const { transport, patches } = recordedTransport(env(), [() => ({ rev: 2 })]);
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "now" } }]);
    expect(patches.length).toBe(0);
    await controller.flushNow();

    expect(patches.length).toBe(1);
    await vi.advanceTimersByTimeAsync(5000); // cancelled debounce must not re-fire
    expect(patches.length).toBe(1);
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

  it("rebases automatically from the 409 body without a refetch round-trip", async () => {
    const serverBody = { ...emptyBody("form"), blocks: [{ id: "a", kind: "text", props: {} }] };
    const { transport, patches, loadCount } = recordedTransport(env(), [
      () => {
        throw new ConflictError(5, "stale", serverBody);
      },
      () => ({ rev: 6 }),
    ]);
    const c = collector();
    const rebased: RebasedEvent[] = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onRebased: (event) => void rebased.push(event),
    });

    controller.enqueue([{ op: "block.update", id: "a", props: { label: "Local edit" } }]);
    await vi.advanceTimersByTimeAsync(500);

    expect(loadCount()).toBe(0); // 409 { rev, body } → rebase without a GET
    expect(rebased.length).toBe(1);
    expect(rebased[0]?.rev).toBe(5);
    expect(rebased[0]?.droppedCount).toBe(0);
    expect(rebased[0]?.doc.body.blocks[0]).toMatchObject({ id: "a", props: { label: "Local edit" } });
    expect(patches.length).toBe(2);
    expect(patches[1]?.baseRev).toBe(5); // patched batch re-sent with the new baseRev
    expect(c.acks).toEqual([5, 6]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
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

  it("raises onConflict when the rebase cannot apply local ops cleanly (§7.3.3)", async () => {
    const serverBody = { ...emptyBody("form"), blocks: [{ id: "a", kind: "text", props: {} }] };
    const { transport, patches, loadCount } = recordedTransport(env({ rev: 5, body: serverBody }), [
      () => {
        throw new ConflictError(5, "stale", serverBody);
      },
    ]);
    const c = collector();
    const conflicts: ConflictEvent[] = [];
    const reconciled: unknown[] = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onConflict: (event) => void conflicts.push(event),
      onReconciled: (doc) => void reconciled.push(doc),
    });

    controller.enqueue([
      { op: "block.update", id: "ghost", props: { label: "deleted on the server" } }, // target gone
      { op: "meta.update", patch: { title: "kept" } },
    ]);
    await vi.advanceTimersByTimeAsync(500);

    expect(loadCount()).toBe(1); // meta.update in the replay → full envelope
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.rev).toBe(5);
    expect(conflicts[0]?.pendingOps.length).toBe(2);
    expect(conflicts[0]?.serverDoc?.meta.title).toBe("Doc");
    expect(controller.conflict).toBe(conflicts[0] ?? null);
    expect(reconciled.length).toBe(0); // no silent rebase — user must choose
    expect(patches.length).toBe(1); // nothing is re-sent while unresolved
    expect(c.statuses).toContain("conflict");
    expect(controller.pendingCount).toBe(2);
    controller.destroy();
  });

  it("resolveConflict('mine') re-sends the losing ops as a new revision", async () => {
    const serverBody = { ...emptyBody("form"), blocks: [{ id: "a", kind: "text", props: {} }] };
    const { transport, patches } = recordedTransport(env({ rev: 5, body: serverBody }), [
      () => {
        throw new ConflictError(5, "stale", serverBody);
      },
      () => ({ rev: 6 }),
    ]);
    const c = collector();
    const resolved: string[] = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onConflictResolved: (mode) => void resolved.push(mode),
    });

    controller.enqueue([
      { op: "block.update", id: "ghost", props: { label: "x" } },
      { op: "meta.update", patch: { title: "kept" } },
    ]);
    await vi.advanceTimersByTimeAsync(500);
    expect(patches.length).toBe(1);

    await controller.resolveConflict("mine");

    expect(resolved).toEqual(["mine"]);
    expect(controller.conflict).toBeNull();
    expect(patches.length).toBe(2);
    expect(patches[1]?.baseRev).toBe(5); // fresh baseRev from the server body
    expect(patches[1]?.ops.map((o) => o.op)).toEqual(["block.update", "meta.update"]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    expect(controller.currentRev).toBe(6);
    controller.destroy();
  });

  it("resolveConflict('theirs') adopts the server document and drops local ops", async () => {
    const serverBody = { ...emptyBody("form"), blocks: [{ id: "a", kind: "text", props: {} }] };
    const { transport, patches } = recordedTransport(env({ rev: 5, body: serverBody }), [
      () => {
        throw new ConflictError(5, "stale", serverBody);
      },
    ]);
    const c = collector();
    const rebased: RebasedEvent[] = [];
    const resolved: string[] = [];
    const queue = fakeQueue();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onRebased: (event) => void rebased.push(event),
      onConflictResolved: (mode) => void resolved.push(mode),
      offlineQueue: queue.port,
    });

    controller.enqueue([{ op: "block.update", id: "ghost", props: { label: "x" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(patches.length).toBe(1);

    await controller.resolveConflict("theirs");

    expect(resolved).toEqual(["theirs"]);
    expect(controller.conflict).toBeNull();
    expect(controller.pendingCount).toBe(0);
    expect(patches.length).toBe(1); // no new PATCH — local state == server state
    expect(rebased.length).toBe(1);
    expect(rebased[0]?.rev).toBe(5);
    expect(rebased[0]?.doc.body.blocks[0]).toMatchObject({ id: "a" });
    expect(c.acks).toContain(5);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    expect(queue.cleared).toContain("doc1"); // §22.2: record dropped on "Use theirs"
    controller.destroy();
  });

  it("pauses network activity while a conflict is unresolved", async () => {
    const serverBody = { ...emptyBody("form"), blocks: [{ id: "a", kind: "text", props: {} }] };
    const { transport, patches } = recordedTransport(env({ rev: 5, body: serverBody }), [
      () => {
        throw new ConflictError(5, "stale", serverBody);
      },
      () => ({ rev: 6 }),
    ]);
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
    });

    controller.enqueue([{ op: "block.update", id: "ghost", props: { label: "x" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(patches.length).toBe(1);

    // Keep editing + waiting: nothing may hit the network before the choice.
    controller.enqueue([{ op: "meta.update", patch: { title: "more" } }]);
    await vi.advanceTimersByTimeAsync(10_000);
    await controller.flushNow();
    expect(patches.length).toBe(1);

    await controller.resolveConflict("mine");
    expect(patches.length).toBe(2);
    expect(patches[1]?.ops.length).toBe(2); // losing ops + edits made meanwhile
    controller.destroy();
  });

  it("retries transient errors with backoff, then succeeds", async () => {
    let _calls = 0;
    const { transport, patches } = recordedTransport(env(), [
      () => {
        _calls += 1;
        throw new TransportError("INTERNAL", "boom", 500);
      },
      () => {
        _calls += 1;
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
    await vi.advanceTimersByTimeAsync(500); // attempt 1 fails
    await vi.advanceTimersByTimeAsync(1000); // backoff 1s → attempt 2 fails
    await vi.advanceTimersByTimeAsync(2000); // backoff 2s → attempt 3 succeeds
    expect(patches.length).toBe(3); // 2 failed attempts + 1 success
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    controller.destroy();
  });

  it("follows the spec backoff 1s,2s,5s,10s then 30s, reset by success (§7.1)", async () => {
    let fail = true;
    const behavior = () => {
      if (fail) throw new TransportError("INTERNAL", "boom", 500);
      return { rev: 99 };
    };
    const { transport, patches } = recordedTransport(env(), Array.from({ length: 12 }, () => behavior));
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500 + 1_000); // attempt 1 @500, attempt 2 @1500
    expect(patches.length).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000); // attempt 3 @3500 (backoff 2s → 5s)
    expect(patches.length).toBe(3);
    await vi.advanceTimersByTimeAsync(5_000); // attempt 4 @8500
    expect(patches.length).toBe(4);
    await vi.advanceTimersByTimeAsync(10_000); // attempt 5 @18500
    expect(patches.length).toBe(5);
    await vi.advanceTimersByTimeAsync(30_000); // attempt 6 @48500 (steady 30s)
    expect(patches.length).toBe(6);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(patches.length).toBe(6); // still on the 30s cadence
    await vi.advanceTimersByTimeAsync(1);
    expect(patches.length).toBe(7);

    // Success resets the sequence: the next failure waits 1s again.
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000); // attempt 7 succeeds
    expect(patches.length).toBe(8);
    expect(controller.status).toBe("saved");

    fail = true;
    controller.enqueue([{ op: "meta.update", patch: { title: "y" } }]);
    await vi.advanceTimersByTimeAsync(500); // attempt 8 fails → backoff restarts at 1s
    await vi.advanceTimersByTimeAsync(500);
    expect(patches.length).toBe(9); // no attempt at +1000 (would be 2s if not reset)
    await vi.advanceTimersByTimeAsync(500);
    expect(patches.length).toBe(10); // attempt 9 at +1500
    controller.destroy();
  });

  it("surfaces an error and stops after maxRetries, keeping the ops queued", async () => {
    const behavior = () => {
      throw new TransportError("NETWORK", "offline");
    };
    const { transport, patches } = recordedTransport(env(), Array.from({ length: 10 }, () => behavior));
    const c = collector();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      maxRetries: 3,
      onStatus: c.onStatus,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500 + 1_000 + 2_000 + 5_000 + 30_000);
    expect(c.statuses).toContain("error");
    expect(controller.pendingCount).toBe(1);
    expect(patches.length).toBe(4); // initial + 3 retries, then it gives up
    await vi.advanceTimersByTimeAsync(60_000);
    expect(patches.length).toBe(4); // no further automatic attempts
    controller.destroy();
  });

  it("destroys cancel pending retries", async () => {
    const behavior = () => {
      throw new TransportError("INTERNAL", "boom", 500);
    };
    const { transport, patches } = recordedTransport(env(), Array.from({ length: 5 }, () => behavior));
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500); // attempt 1 fails, sleeping 1s
    controller.destroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(patches.length).toBe(1); // the backoff sleep was cancelled
  });

  it("enters offline when isOnline() is false and flushes on the online event (§7.1)", async () => {
    const { transport, patches } = recordedTransport(env(), [() => ({ rev: 2 })]);
    const c = collector();
    let online = false;
    let fireOnline: () => void = () => undefined;
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      isOnline: () => online,
      addOnlineListener: (cb) => {
        fireOnline = cb;
        return () => {
          fireOnline = () => undefined;
        };
      },
      onStatus: c.onStatus,
      onAck: c.onAck,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "kept while offline" } }]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(patches.length).toBe(0); // never touched the network
    expect(c.statuses).toContain("offline");
    expect(controller.pendingCount).toBe(1); // ops retained

    online = true;
    fireOnline(); // window 'online'
    await vi.advanceTimersByTimeAsync(0);

    expect(patches.length).toBe(1);
    expect(patches[0]?.ops).toEqual([{ op: "meta.update", patch: { title: "kept while offline" } }]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    expect(c.acks).toEqual([2]);
    controller.destroy();
  });

  it("enters offline when fetch throws TypeError and flushes on reconnect (§7.1)", async () => {
    const { transport, patches } = recordedTransport(env(), [
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => ({ rev: 2 }),
    ]);
    const c = collector();
    let fireOnline: () => void = () => undefined;
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      addOnlineListener: (cb) => {
        fireOnline = cb;
        return () => undefined;
      },
      onStatus: c.onStatus,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(c.statuses).toContain("offline");
    expect(controller.pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000); // no backoff churn while offline
    expect(patches.length).toBe(1);

    fireOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(patches.length).toBe(2);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    controller.destroy();
  });

  it("rolls back exactly the op rejected with 422 and retries the rest (§14)", async () => {
    const ghost: Op = { op: "block.update", id: "ghost", props: { label: "x" } };
    const { transport, patches } = recordedTransport(env(), [
      () => {
        throw new OpRejectedError(1, "NOT_FOUND", "block ghost not found");
      },
      () => ({ rev: 2 }),
    ]);
    const c = collector();
    const rejected: OpRejectedEvent[] = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onOpRejected: (event) => void rejected.push(event),
    });

    controller.enqueue([
      { op: "meta.update", patch: { title: "a" } },
      ghost,
      { op: "meta.update", patch: { title: "b" } },
    ]);
    await vi.advanceTimersByTimeAsync(500);

    expect(rejected.length).toBe(1);
    expect(rejected[0]?.op).toEqual(ghost);
    expect(rejected[0]?.index).toBe(1);
    expect(rejected[0]?.code).toBe("NOT_FOUND");
    expect(patches.length).toBe(2);
    expect(patches[1]?.baseRev).toBe(1);
    expect(patches[1]?.ops).toEqual([
      { op: "meta.update", patch: { title: "a" } },
      { op: "meta.update", patch: { title: "b" } },
    ]);
    expect(c.acks).toEqual([2]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    controller.destroy();
  });

  // §14 plan-limit answers (follow-up #8): 402/403 keep the ops (zero data
  // loss), park WITHOUT a retry timer, and fire onPlanLimit so the UI can
  // explain inline — never a dead-end error, never backoff churn.
  it("keeps the batch and fires onPlanLimit on 402 PLAN_LIMIT (§14, parked)", async () => {
    const { transport, patches } = recordedTransport(env(), [
      () => {
        throw new PlanLimitError('Plan limit reached for "notifyEmailsLimit" — upgrade to pro.', "notifyEmailsLimit", "pro");
      },
      () => ({ rev: 2 }),
    ]);
    const c = collector();
    const planLimits: PlanLimitEvent[] = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onPlanLimit: (event) => void planLimits.push(event),
    });

    const batch: Op[] = [{ op: "settings.update", patch: { notifyEmails: ["a@b.co"] } }];
    controller.enqueue(batch);
    await vi.advanceTimersByTimeAsync(500);

    expect(planLimits).toHaveLength(1);
    expect(planLimits[0]).toEqual({
      status: 402,
      message: 'Plan limit reached for "notifyEmailsLimit" — upgrade to pro.',
      capability: "notifyEmailsLimit",
    });
    expect(controller.pendingCount).toBe(1); // kept, never dropped
    expect(c.statuses[c.statuses.length - 1]).toBe("error");

    // Parked: no transient backoff churn while the plan blocks the save.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(patches.length).toBe(1);

    // The next flush trigger retries the SAME batch (e.g. after an upgrade).
    controller.enqueue([{ op: "meta.update", patch: { title: "nudge" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(patches.length).toBe(2);
    expect(patches[1]?.ops).toEqual([...batch, { op: "meta.update", patch: { title: "nudge" } }]);
    expect(c.acks).toEqual([2]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    controller.destroy();
  });

  it("fires onPlanLimit with status 403 and null capability on FORBIDDEN (§14)", async () => {
    const { transport, patches } = recordedTransport(env(), [
      () => {
        throw new ForbiddenError("Not allowed for this credential");
      },
      () => ({ rev: 2 }),
    ]);
    const c = collector();
    const planLimits: PlanLimitEvent[] = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onPlanLimit: (event) => void planLimits.push(event),
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500);

    expect(planLimits).toHaveLength(1);
    expect(planLimits[0]?.status).toBe(403);
    expect(planLimits[0]?.capability).toBeNull();
    expect(controller.pendingCount).toBe(1); // kept
    await vi.advanceTimersByTimeAsync(60_000); // parked, no churn
    expect(patches.length).toBe(1);
    controller.destroy();
  });

  it("mirrors pending ops into the offline queue and clears on ack (§22.2)", async () => {
    const { transport, patches } = recordedTransport(env(), [() => ({ rev: 2 })]);
    const queue = fakeQueue();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      offlineQueue: queue.port,
    });

    const ops: Op[] = [
      { op: "meta.update", patch: { title: "a" } },
      { op: "meta.update", patch: { title: "b" } },
    ];
    controller.enqueue(ops);
    await vi.advanceTimersByTimeAsync(100); // 100ms debounced write

    expect(queue.saved.length).toBe(1);
    expect(queue.saved[0]).toMatchObject({ docId: "doc1", baseRev: 1 });
    expect(queue.saved[0]?.ops).toEqual(ops);
    expect(typeof queue.saved[0]?.updatedAt).toBe("number");

    await vi.advanceTimersByTimeAsync(400); // flush + ack
    expect(patches.length).toBe(1);
    expect(queue.cleared).toEqual(["doc1"]); // deleted on 200 OK, nothing in flight
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

  it("parks on an unauthenticated save (401 / §4 403) and keeps the ops (§7.1 #3)", async () => {
    const behavior = () => {
      throw new UnauthenticatedError(
        "FORBIDDEN",
        "Authentication required: session cookie or Authorization: Bearer ff_…",
        403,
      );
    };
    const { transport, patches } = recordedTransport(env(), [behavior, () => ({ rev: 2 })]);
    const c = collector();
    const raised: number[] = [];
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onUnauthenticated: ({ pendingCount }) => void raised.push(pendingCount),
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "kept" } }]);
    await vi.advanceTimersByTimeAsync(500);

    expect(patches.length).toBe(1);
    expect(c.statuses).toContain("unauthenticated");
    expect(controller.status).toBe("unauthenticated");
    expect(controller.isUnauthenticated).toBe(true);
    expect(controller.pendingCount).toBe(1); // ops retained
    expect(raised).toEqual([1]); // prompt raised once
    expect(c.statuses).not.toContain("offline"); // distinct from the offline park

    // Parked: NO backoff retries while the session is expired.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(patches.length).toBe(1);
    expect(controller.pendingCount).toBe(1);
    controller.destroy();
  });

  it("resumes the queue after a successful session re-check (re-auth)", async () => {
    const behavior = () => {
      throw new UnauthenticatedError("UNAUTHORIZED", "Session expired", 401);
    };
    const { transport, patches } = recordedTransport(env(), [behavior, () => ({ rev: 2 })]);
    const c = collector();
    const checkSession = vi.fn(async () => true);
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      checkSession,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "kept through re-auth" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.isUnauthenticated).toBe(true);

    const resumed = await controller.resumeAfterReauth();

    expect(resumed).toBe(true);
    expect(checkSession).toHaveBeenCalledTimes(1);
    expect(patches.length).toBe(2);
    expect(patches[1]?.ops).toEqual([{ op: "meta.update", patch: { title: "kept through re-auth" } }]);
    expect(c.acks).toEqual([2]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
    expect(controller.isUnauthenticated).toBe(false);
    controller.destroy();
  });

  it("stays parked when the session re-check reports still signed out", async () => {
    const behavior = () => {
      throw new UnauthenticatedError(
        "FORBIDDEN",
        "Authentication required: session cookie or Authorization: Bearer ff_…",
        403,
      );
    };
    const { transport, patches } = recordedTransport(env(), [behavior, () => ({ rev: 2 })]);
    const c = collector();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      checkSession: async () => false,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "x" } }]);
    await vi.advanceTimersByTimeAsync(500);

    const resumed = await controller.resumeAfterReauth();

    expect(resumed).toBe(false);
    expect(patches.length).toBe(1); // no retry without a session
    expect(controller.pendingCount).toBe(1);
    expect(controller.status).toBe("unauthenticated");
    controller.destroy();
  });

  it("keeps collecting edits while parked (with the §22.2 mirror) and sends them after resume", async () => {
    const behavior = () => {
      throw new UnauthenticatedError("UNAUTHORIZED", "Session expired", 401);
    };
    const { transport, patches } = recordedTransport(env(), [behavior, () => ({ rev: 2 })]);
    const c = collector();
    const queue = fakeQueue();
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      checkSession: async () => true,
      offlineQueue: queue.port,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "a" } }]);
    await vi.advanceTimersByTimeAsync(500); // flush fails with the expired session
    controller.enqueue([{ op: "meta.update", patch: { title: "b" } }]);
    await vi.advanceTimersByTimeAsync(5_000); // parked — no network, mirror updated

    expect(patches.length).toBe(1);
    expect(controller.pendingCount).toBe(2);
    expect(controller.status).toBe("unauthenticated"); // stays sticky while parked
    expect(queue.saved.at(-1)?.ops).toEqual([
      { op: "meta.update", patch: { title: "a" } },
      { op: "meta.update", patch: { title: "b" } },
    ]);

    const resumed = await controller.resumeAfterReauth();

    expect(resumed).toBe(true);
    expect(patches.length).toBe(2);
    expect(patches[1]?.ops).toEqual([
      { op: "meta.update", patch: { title: "a" } },
      { op: "meta.update", patch: { title: "b" } },
    ]);
    expect(queue.cleared).toEqual(["doc1"]); // ack cleared the mirror
    controller.destroy();
  });

  it("dismiss parks the queue; the next manual retry re-attempts and re-raises", async () => {
    const behavior = () => {
      throw new UnauthenticatedError(
        "FORBIDDEN",
        "Authentication required: session cookie or Authorization: Bearer ff_…",
        403,
      );
    };
    const { transport, patches } = recordedTransport(env(), [
      behavior,
      behavior,
      () => ({ rev: 2 }),
    ]);
    const c = collector();
    const raised: number[] = [];
    let signedIn = false;
    const controller = new AutosaveController({
      transport: transport as unknown as MockTransport & typeof transport,
      docId: "doc1",
      initialRev: 1,
      onStatus: c.onStatus,
      onAck: c.onAck,
      onUnauthenticated: ({ pendingCount }) => void raised.push(pendingCount),
      checkSession: async () => signedIn,
    });

    controller.enqueue([{ op: "meta.update", patch: { title: "kept" } }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(raised).toEqual([1]);

    controller.dismissReauth();
    expect(controller.isUnauthenticated).toBe(false);
    expect(controller.status).toBe("dirty"); // ops kept, chip back to unsaved
    expect(controller.pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000); // nothing automatic after dismiss
    expect(patches.length).toBe(1);

    await controller.flushNow(); // manual retry — session still expired
    expect(patches.length).toBe(2);
    expect(controller.status).toBe("unauthenticated");
    expect(raised).toEqual([1, 1]); // prompt re-raised
    expect(controller.pendingCount).toBe(1);

    signedIn = true;
    const resumed = await controller.resumeAfterReauth();
    expect(resumed).toBe(true);
    expect(patches.length).toBe(3);
    expect(c.acks).toEqual([2]);
    expect(c.statuses[c.statuses.length - 1]).toBe("saved");
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

  // §13/§14 hard limits (follow-up #10): the flush refuses growth batches
  // when the local body is over the ~1 MB JSON cap; pure deletes always go.
  describe("hard limits — 1 MB body gate at flush", () => {
    const oversizeBody = (): DocumentEnvelope["body"] => ({
      ...emptyBody("form"),
      blocks: [
        { id: "a", kind: "short-text", props: { label: "x".repeat(1_000_001) } },
      ],
    });

    function controllerWithOversizeDoc(events: {
      statuses: AutosaveStatus[];
      limits: Array<{ kind: string; chars: number }>;
    }) {
      const { transport, patches } = recordedTransport(env({ body: oversizeBody() }), [() => ({ rev: 2 })]);
      const controller = new AutosaveController({
        transport: transport as unknown as MockTransport,
        docId: "doc1",
        initialRev: 1,
        snapshotDoc: () => ({ meta: { title: "Doc" }, body: oversizeBody() }),
        onStatus: (s) => void events.statuses.push(s),
        onLimitExceeded: (e) => void events.limits.push(e),
      });
      return { controller, patches };
    }

    it("refuses a GROWTH batch before sending: queue parked, error status, onLimitExceeded", async () => {
      const events = { statuses: [] as AutosaveStatus[], limits: [] as Array<{ kind: string; chars: number }> };
      const { controller, patches } = controllerWithOversizeDoc(events);

      controller.enqueue([{ op: "meta.update", patch: { title: "grow?" } }]);
      await vi.advanceTimersByTimeAsync(600);

      expect(patches.length).toBe(0); // never sent — the server would 413
      expect(controller.pendingCount).toBe(1); // parked like the offline state
      expect(events.statuses).toContain("error");
      expect(events.limits.length).toBe(1);
      expect(events.limits[0]?.kind).toBe("bytes");
      expect(events.limits[0]?.chars).toBeGreaterThan(1_000_000);
      controller.destroy();
    });

    it("retries the parked batch on the next flush after the doc shrinks under the cap", async () => {
      const events = { statuses: [] as AutosaveStatus[], limits: [] as Array<{ kind: string; chars: number }> };
      const { transport } = recordedTransport(env(), [() => ({ rev: 2 })]);
      let oversized = true;
      const controller = new AutosaveController({
        transport: transport as unknown as MockTransport,
        docId: "doc1",
        initialRev: 1,
        snapshotDoc: () => ({
          meta: { title: "Doc" },
          body: oversized
            ? oversizeBody()
            : { ...emptyBody("form"), blocks: [{ id: "a", kind: "short-text", props: {} }] },
        }),
        onLimitExceeded: (e) => void events.limits.push(e),
      });

      controller.enqueue([{ op: "meta.update", patch: { title: "grow?" } }]);
      await vi.advanceTimersByTimeAsync(600);
      expect(events.limits.length).toBe(1);

      // User deletes the huge content → next flush passes.
      oversized = false;
      await controller.flushNow();
      expect(events.limits.length).toBe(1); // no additional refusal
      expect(controller.pendingCount).toBe(0);
      controller.destroy();
    });

    it("always sends pure-removal batches so the user can delete their way back under the cap", async () => {
      const events = { statuses: [] as AutosaveStatus[], limits: [] as Array<{ kind: string; chars: number }> };
      const { controller, patches } = controllerWithOversizeDoc(events);

      controller.enqueue([{ op: "block.remove", id: "a" }]);
      await vi.advanceTimersByTimeAsync(600);

      expect(patches.length).toBe(1); // the delete went through
      expect(events.limits.length).toBe(0);
      expect(controller.pendingCount).toBe(0);
      controller.destroy();
    });
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
