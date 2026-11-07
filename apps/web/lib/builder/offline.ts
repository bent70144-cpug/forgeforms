// §22.2 IndexedDB offline queue + §7.2 recovery helpers.
//
// Database contract (spec §22.2 — followed exactly):
//   DB      `formforge_builder` (version 1)
//   Store   `pending_batches`, keyPath `docId`
//   Record  `{ docId: string, baseRev: number, ops: DocumentOp[], updatedAt: number }`
//
// Lifecycle (spec §22.2): the record is written (debounced 100 ms) whenever
// the builder's pending queue changes, and deleted on the 200-OK ack (when no
// further ops are in flight) or when the user discards / chooses "Use theirs".
//
// Everything is fail-open: IndexedDB errors are logged and swallowed — the
// autosave loop must never throw because persistence hiccuped. All browser
// globals are feature-detected so this module is importable (and testable)
// in plain node; tests inject an in-memory `IdbStoragePort`.

import type { Op } from "./ops";

/** §22.2 stored record shape. */
export type PendingBatchRecord = {
  docId: string;
  baseRev: number;
  ops: Op[];
  updatedAt: number;
};

export const BUILDER_DB_NAME = "formforge_builder";
export const BUILDER_DB_VERSION = 1;
export const PENDING_BATCHES_STORE = "pending_batches";
/** §22.2: the record is written debounced 100 ms after a pending change. */
export const OFFLINE_SAVE_DEBOUNCE_MS = 100;

/**
 * Minimal storage seam over the `pending_batches` object store. Inject an
 * in-memory fake in tests; the default adapter wraps `window.indexedDB`.
 */
export type IdbStoragePort = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

/** The seam the AutosaveController consumes (all methods never throw). */
export type OfflineQueuePort = {
  /** Debounced (100 ms) last-write-wins persistence of the pending record. */
  saveQueue(record: PendingBatchRecord): void;
  /** `null` when nothing (or a corrupt record) is stored for `docId`. */
  loadQueue(docId: string): Promise<PendingBatchRecord | null>;
  /** Cancels any debounced save and removes the record immediately. */
  clearQueue(docId: string): Promise<void>;
};

function logWhere(method: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[formforge:offline] ${method} failed (continuing without persistence): ${message}`);
}

function isPendingBatchRecord(value: unknown): value is PendingBatchRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<PendingBatchRecord> | null;
  return (
    typeof v?.docId === "string" &&
    typeof v.baseRev === "number" &&
    Array.isArray(v.ops) &&
    typeof v.updatedAt === "number"
  );
}

// ---------------------------------------------------------------------------
// Default IndexedDB adapter (browser only; lazy — importing never opens a DB)
// ---------------------------------------------------------------------------

function defaultIdbStorage(): IdbStoragePort {
  let openPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    openPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(BUILDER_DB_NAME, BUILDER_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PENDING_BATCHES_STORE)) {
          db.createObjectStore(PENDING_BATCHES_STORE, { keyPath: "docId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    });
    return openPromise;
  };

  const run = <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    return open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(PENDING_BATCHES_STORE, mode);
          const req = fn(tx.objectStore(PENDING_BATCHES_STORE));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
        }),
    );
  };

  return {
    get: (key) => run<unknown>("readonly", (store) => store.get(key)),
    set: (key, value) =>
      run<void>("readwrite", (store) => store.put({ ...(value as Record<string, unknown>), docId: key })),
    delete: (key) => run<undefined>("readwrite", (store) => store.delete(key)),
  };
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

type OfflineQueueOptions = {
  schedule?: (fn: () => void, ms: number) => () => void;
};

/**
 * Builds the offline queue port. `storage` injects a test double; without it
 * the default IndexedDB adapter is used, falling back to a memory-only store
 * when IndexedDB is unavailable (SSR, private mode quirks, node tests).
 */
export function createOfflineQueue(
  storage?: IdbStoragePort,
  options?: OfflineQueueOptions,
): OfflineQueuePort {
  const schedule = options?.schedule ?? defaultSchedule;
  const backing: IdbStoragePort | null =
    storage ?? (typeof indexedDB !== "undefined" ? defaultIdbStorage() : null);
  // Memory mirror: authoritative within this session, and the only store when
  // IndexedDB is unavailable.
  const memory = new Map<string, PendingBatchRecord>();
  let cancelSave: (() => void) | null = null;
  let staged: PendingBatchRecord | null = null;

  const persist = async (record: PendingBatchRecord): Promise<void> => {
    memory.set(record.docId, record);
    if (!backing) return;
    try {
      await backing.set(record.docId, record);
    } catch (err) {
      logWhere("saveQueue", err); // never throw into the autosave loop
    }
  };

  return {
    saveQueue(record: PendingBatchRecord): void {
      if (!isPendingBatchRecord(record)) {
        logWhere("saveQueue", new Error("invalid record shape — ignoring"));
        return;
      }
      staged = record; // last write wins inside the debounce window
      if (cancelSave) return;
      cancelSave = schedule(() => {
        cancelSave = null;
        const next = staged;
        staged = null;
        if (next) void persist(next);
      }, OFFLINE_SAVE_DEBOUNCE_MS);
    },

    async loadQueue(docId: string): Promise<PendingBatchRecord | null> {
      const local = memory.get(docId);
      if (local) return local;
      if (!backing) return null;
      try {
        const raw = await backing.get(docId);
        return isPendingBatchRecord(raw) ? raw : null; // corrupt record → null
      } catch (err) {
        logWhere("loadQueue", err);
        return null;
      }
    },

    async clearQueue(docId: string): Promise<void> {
      if (cancelSave) {
        cancelSave();
        cancelSave = null;
        staged = null;
      }
      memory.delete(docId);
      if (!backing) return;
      try {
        await backing.delete(docId);
      } catch (err) {
        logWhere("clearQueue", err);
      }
    },
  };
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

// ---------------------------------------------------------------------------
// Shared instance + recovery API (§7.2)
// ---------------------------------------------------------------------------

const sharedQueue: OfflineQueuePort = createOfflineQueue();

/**
 * §7.2 recovery on load: read the offline record for `docId`, if any.
 * Returns `{ record }` when unsaved work exists; the CALLER decides between
 * Restore and Discard (and treats `record.baseRev < serverRev` as a §7.3
 * conflict). `null` when there is no usable record.
 */
export async function recoverPending(
  docId: string,
  serverRev: number,
  queue: OfflineQueuePort = sharedQueue,
): Promise<{ record: PendingBatchRecord } | null> {
  const record = await queue.loadQueue(docId);
  if (!record) return null;
  if (record.baseRev > serverRev) return null; // nonsense state — drop it
  return { record };
}

/** §7.2 "Discard" — drop the stored pending ops for `docId`. */
export async function discardPending(docId: string, queue: OfflineQueuePort = sharedQueue): Promise<void> {
  await queue.clearQueue(docId);
}

// ---------------------------------------------------------------------------
// beforeunload helpers (§7.1 — page wiring happens in the UI milestone)
// ---------------------------------------------------------------------------

/** Only guard the unload when there are unsent ops (§7.1). */
export function shouldGuardUnload(pendingCount: number): boolean {
  return pendingCount > 0;
}

export type BeaconFlushPayload = { baseRev: number; ops: readonly Op[] };

export type BeaconFlushDeps = {
  fetch?: typeof fetch;
  sendBeacon?: (url: string, data: BodyInit) => boolean;
};

/**
 * Best-effort flush during unload (§7.1): `navigator.sendBeacon` first,
 * keepalive `fetch` PATCH as the fallback. Resolves true when the payload
 * was (probably) delivered. Pure seam-injected — no globals touched in tests.
 */
export async function flushViaBeacon(
  docId: string,
  payload: BeaconFlushPayload,
  deps: BeaconFlushDeps = {},
): Promise<boolean> {
  const url = `/api/v1/documents/${encodeURIComponent(docId)}`;
  const body = JSON.stringify({ baseRev: payload.baseRev, ops: payload.ops });

  const beacon =
    deps.sendBeacon ??
    (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? navigator.sendBeacon.bind(navigator)
      : undefined);
  if (beacon) {
    try {
      const queued = beacon(url, new Blob([body], { type: "application/json" }));
      if (queued) return true;
      // sendBeacon refused (queue full / payload too large) — try fetch.
    } catch {
      // fall through to fetch
    }
  }

  const fetchFn = deps.fetch ?? fetch;
  try {
    const res = await fetchFn(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
