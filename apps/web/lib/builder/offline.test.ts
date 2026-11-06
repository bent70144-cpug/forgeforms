import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILDER_DB_NAME,
  PENDING_BATCHES_STORE,
  createOfflineQueue,
  discardPending,
  flushViaBeacon,
  recoverPending,
  shouldGuardUnload,
  type IdbStoragePort,
  type OfflineQueuePort,
  type PendingBatchRecord,
} from "./offline";
import type { Op } from "./ops";

function record(overrides: Partial<PendingBatchRecord> = {}): PendingBatchRecord {
  const ops: Op[] = [{ op: "meta.update", patch: { title: "hello" } }];
  return { docId: "doc1", baseRev: 3, ops, updatedAt: 1000, ...overrides };
}

/** In-memory `IdbStoragePort` fake — the injected seam for plain-node tests. */
function memoryStorage() {
  const map = new Map<string, unknown>();
  const calls = { set: 0, get: 0, delete: 0 };
  const storage: IdbStoragePort = {
    async get(key) {
      calls.get += 1;
      return map.get(key);
    },
    async set(key, value) {
      calls.set += 1;
      map.set(key, value);
    },
    async delete(key) {
      calls.delete += 1;
      map.delete(key);
    },
  };
  return { storage, map, calls };
}

/** Direct OfflineQueuePort stub for the recovery API tests. */
function stubQueue(record: PendingBatchRecord | null) {
  const cleared: string[] = [];
  const queue: OfflineQueuePort = {
    saveQueue: () => undefined,
    loadQueue: async () => record,
    clearQueue: async (docId) => void cleared.push(docId),
  };
  return { queue, cleared };
}

describe("createOfflineQueue (§22.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips save → load → clear through the injected storage", async () => {
    const { storage, calls } = memoryStorage();
    const queue = createOfflineQueue(storage);

    queue.saveQueue(record({ updatedAt: 1234 }));
    await vi.advanceTimersByTimeAsync(100); // debounced write
    expect(calls.set).toBe(1);

    const loaded = await queue.loadQueue("doc1");
    expect(loaded).toEqual(record({ updatedAt: 1234 }));

    await queue.clearQueue("doc1");
    expect(calls.delete).toBe(1);
    expect(await queue.loadQueue("doc1")).toBeNull();
  });

  it("stores records under the pinned db/store names via the default adapter", async () => {
    // The §22.2 names are exported constants — pin them so a refactor that
    // drifts from `formforge_builder` / `pending_batches` fails here first.
    expect(BUILDER_DB_NAME).toBe("formforge_builder");
    expect(PENDING_BATCHES_STORE).toBe("pending_batches");
  });

  it("debounces saves: two writes inside 100ms persist once (last wins)", async () => {
    const { storage, calls } = memoryStorage();
    const queue = createOfflineQueue(storage);

    queue.saveQueue(record({ updatedAt: 1 }));
    queue.saveQueue(record({ updatedAt: 2 }));
    queue.saveQueue(record({ ops: [{ op: "meta.update", patch: { title: "final" } }], updatedAt: 3 }));
    await vi.advanceTimersByTimeAsync(100);

    expect(calls.set).toBe(1);
    expect((await queue.loadQueue("doc1"))?.updatedAt).toBe(3);
  });

  it("clearQueue cancels a debounced save that has not fired yet", async () => {
    const { storage, calls } = memoryStorage();
    const queue = createOfflineQueue(storage);

    queue.saveQueue(record());
    await queue.clearQueue("doc1");
    await vi.advanceTimersByTimeAsync(500);

    expect(calls.set).toBe(0);
    expect(await queue.loadQueue("doc1")).toBeNull();
  });

  it("tolerates corrupt records (loadQueue → null)", async () => {
    const { storage, map } = memoryStorage();
    const queue = createOfflineQueue(storage);

    map.set("doc1", { nonsense: true });
    map.set("doc2", 42);
    map.set("doc3", { docId: "doc3", baseRev: "not-a-number", ops: [], updatedAt: 1 });

    expect(await queue.loadQueue("doc1")).toBeNull();
    expect(await queue.loadQueue("doc2")).toBeNull();
    expect(await queue.loadQueue("doc3")).toBeNull();
  });

  it("ignores records with an invalid shape passed to saveQueue", async () => {
    const { storage, calls } = memoryStorage();
    const queue = createOfflineQueue(storage);

    queue.saveQueue({ docId: "doc1" } as unknown as PendingBatchRecord);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.set).toBe(0);
  });

  it("never throws when the storage layer fails (memory mirror keeps the queue)", async () => {
    const failing: IdbStoragePort = {
      get: async () => {
        throw new Error("idb get exploded");
      },
      set: async () => {
        throw new Error("idb set exploded");
      },
      delete: async () => {
        throw new Error("idb delete exploded");
      },
    };
    const queue = createOfflineQueue(failing);

    expect(() => queue.saveQueue(record())).not.toThrow();
    await vi.advanceTimersByTimeAsync(100); // persist attempt swallows the error
    // The in-memory mirror still serves the record (fail-open), and clearing
    // it works even though the backing store rejects.
    await expect(queue.loadQueue("doc1")).resolves.toEqual(record());
    await expect(queue.clearQueue("doc1")).resolves.toBeUndefined();
    await expect(queue.loadQueue("doc1")).resolves.toBeNull();
  });

  it("falls back to an in-memory store when no storage is injected and IndexedDB is absent", async () => {
    // Node test env: `typeof indexedDB === "undefined"` → memory-only port.
    const queue = createOfflineQueue();

    queue.saveQueue(record({ baseRev: 7, updatedAt: 5 }));
    await vi.advanceTimersByTimeAsync(100);

    expect(await queue.loadQueue("doc1")).toEqual(record({ baseRev: 7, updatedAt: 5 }));
    await queue.clearQueue("doc1");
    expect(await queue.loadQueue("doc1")).toBeNull();
  });

  it("discardPending clears the stored record", async () => {
    const { storage } = memoryStorage();
    const queue = createOfflineQueue(storage);
    queue.saveQueue(record());
    await vi.advanceTimersByTimeAsync(100);

    await discardPending("doc1", queue);

    expect(await queue.loadQueue("doc1")).toBeNull();
  });
});

describe("recovery API (§7.2)", () => {
  it("recoverPending returns the record when unsaved work exists", async () => {
    const rec = record({ baseRev: 3 });
    const { queue } = stubQueue(rec);
    await expect(recoverPending("doc1", 3, queue)).resolves.toEqual({ record: rec });
  });

  it("recoverPending still returns records whose baseRev is behind the server (caller treats as §7.3 conflict)", async () => {
    const rec = record({ baseRev: 2 });
    const { queue } = stubQueue(rec);
    await expect(recoverPending("doc1", 5, queue)).resolves.toEqual({ record: rec });
  });

  it("recoverPending drops nonsense records (baseRev ahead of the server)", async () => {
    const { queue } = stubQueue(record({ baseRev: 9 }));
    await expect(recoverPending("doc1", 5, queue)).resolves.toBeNull();
  });

  it("recoverPending returns null when nothing is stored", async () => {
    const { queue } = stubQueue(null);
    await expect(recoverPending("doc1", 3, queue)).resolves.toBeNull();
  });
});

describe("unload helpers (§7.1)", () => {
  it("shouldGuardUnload only guards when ops are pending", () => {
    expect(shouldGuardUnload(0)).toBe(false);
    expect(shouldGuardUnload(1)).toBe(true);
    expect(shouldGuardUnload(12)).toBe(true);
  });

  it("flushViaBeacon prefers sendBeacon and does not fetch", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    const beacon = vi.fn((_url: string, _data: BodyInit) => true);

    const ok = await flushViaBeacon(
      "doc1",
      { baseRev: 4, ops: [{ op: "meta.update", patch: { title: "x" } }] },
      { fetch: fetchMock as unknown as typeof fetch, sendBeacon: beacon },
    );

    expect(ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, data] = beacon.mock.calls[0] as [string, Blob];
    expect(url).toBe("/api/v1/documents/doc1");
    expect(JSON.parse(await data.text())).toEqual({
      baseRev: 4,
      ops: [{ op: "meta.update", patch: { title: "x" } }],
    });
  });

  it("flushViaBeacon falls back to a keepalive PATCH when sendBeacon refuses", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    const beacon = vi.fn((_url: string, _data: BodyInit) => false);

    const ok = await flushViaBeacon("doc1", { baseRev: 4, ops: [] }, {
      fetch: fetchMock as unknown as typeof fetch,
      sendBeacon: beacon,
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ baseRev: 4, ops: [] });
  });

  it("flushViaBeacon uses keepalive fetch when no beacon exists", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 500 }));

    const ok = await flushViaBeacon("doc1", { baseRev: 4, ops: [] }, { fetch: fetchMock as unknown as typeof fetch });

    expect(ok).toBe(false); // delivery not confirmed → caller keeps the guard
  });

  it("flushViaBeacon resolves false when the fetch itself fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const ok = await flushViaBeacon("doc1", { baseRev: 4, ops: [] }, { fetch: fetchMock as unknown as typeof fetch });
    expect(ok).toBe(false);
  });
});
