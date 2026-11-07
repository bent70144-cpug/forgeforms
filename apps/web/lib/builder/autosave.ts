// Autosave queue (spec §7.1 "Autosave", §7.2 recovery, §7.3 conflicts, §14 422).
//
// - Debounces edits (default 500 ms after the last change, max wait 5 s under
//   continuous typing) and serializes PATCH requests — one in-flight request
//   at a time, ops made while in flight queue for the next batch.
// - Sends `{ baseRev, ops }` per spec §22.1; on `409 { rev, body }` it rebases
//   automatically (§7.3): the pending ops are replayed onto the server body
//   best-effort and, when every op still applies cleanly and the result is
//   structurally valid, the merged document is adopted locally and re-sent
//   with the fresh rev. When the rebase cannot apply cleanly the controller
//   raises `onConflict` and waits for `resolveConflict("mine" | "theirs")`.
// - `422 { opIndex, code, message }` (§14) rolls back exactly one op locally
//   (`onOpRejected`) and retries the trimmed batch.
// - Retries transient failures (network / 5xx) with the spec backoff sequence
//   1 s, 2 s, 5 s, 10 s, then every 30 s, keeping the pending ops. A fetch
//   failure (TypeError) or `navigator.onLine === false` surfaces the
//   "offline" status: editing continues, the queue is kept, and a flush is
//   attempted automatically on the window `online` event.
// - Optionally mirrors the pending queue into the §22.2 IndexedDB offline
//   queue (debounced 100 ms, cleared on ack / "Use theirs" / discard).
//
// Framework-agnostic and dependency-injected (`schedule`, `now`, `isOnline`,
// `addOnlineListener`, `offlineQueue`) so the whole state machine is testable
// with fake timers and scripted transports — no DOM or IndexedDB required.

import type { Block, DocumentBody, DocumentEnvelope } from "../bridge";
import { applyOpsBestEffort, type EditableDoc, type Op } from "./ops";
import { ConflictError, type DocumentTransport, type PatchResult, OpRejectedError } from "./transport";
import type { OfflineQueuePort } from "./offline";
import { batchImpliesGrowth, estimateBodyJsonChars, isBodyOverLimit } from "./limits";

/**
 * Save-state machine statuses. `offline` (spec §3.1/§7.1) means "edits are
 * kept locally and will sync when the connection returns".
 */
export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error" | "offline";

export type StatusInfo = { at: number; message?: string };

/** Automatic rebase succeeded (§7.3.2) — the caller adopts `{ doc, rev }`. */
export type RebasedEvent = { doc: EditableDoc; rev: number; droppedCount: number };

/**
 * Automatic rebase failed (§7.3.3) — the UI shows the conflict dialog. The
 * controller keeps `pendingOps` and the server snapshot so `resolveConflict`
 * can apply either choice without another round-trip.
 */
export type ConflictEvent = {
  /** The server's current revision at conflict time. */
  rev: number;
  /** Full server document when available (title/slug + body). */
  serverDoc: EditableDoc | null;
  /** Raw server body from the 409 (always set when `serverDoc` is). */
  serverBody: DocumentBody | null;
  /** The local ops that lost the race (plus any enqueued during recovery). */
  pendingOps: Op[];
};

export type ConflictMode = "mine" | "theirs";

/** One op rejected by a 422 (§14) — the UI marks the block and toasts. */
export type OpRejectedEvent = { op: Op; index: number; code: string; message: string };

/**
 * §13/§14 hard limit hit at flush time (follow-up #10): the local document
 * body is over the ~1 MB JSON cap, so the growth batch is refused BEFORE it
 * is sent (the server would answer 413 anyway). The batch stays queued.
 */
export type LimitExceededEvent = { kind: "bytes"; chars: number };

export type AutosaveOptions = {
  transport: DocumentTransport;
  docId: string;
  initialRev: number;
  /** Trailing debounce before a flush (spec §7.1: 500 ms). */
  debounceMs?: number;
  /** Max time an unsent op may wait under continuous typing (§7.1: 5 s). */
  maxWaitMs?: number;
  /**
   * Transient (network/5xx) retries before giving up and staying in "error".
   * Default: unlimited — the spec backoff settles at one attempt every 30 s.
   */
  maxRetries?: number;
  /** 409 recoveries within one flush chain before raising the dialog (§7.3). */
  maxRecoveries?: number;
  /** §22.2 IndexedDB queue — mirrors pending ops for crash/reload recovery. */
  offlineQueue?: OfflineQueuePort;
  /** Default: `navigator.onLine` when available, otherwise assumed online. */
  isOnline?: () => boolean;
  /** Subscribes to the browser `online` event; returns an unsubscribe fn. */
  addOnlineListener?: (cb: () => void) => () => void;
  /**
   * Current local document, when the embedder can provide it. Used to keep
   * correct meta (title/slug) when rebasing from a bare 409 body.
   */
  snapshotDoc?: () => EditableDoc | null;
  /** Structural check on a rebased document (§7.3.1 "the result validates"). */
  validateDoc?: (doc: EditableDoc) => boolean;
  onStatus?: (status: AutosaveStatus, info: StatusInfo) => void;
  onAck?: (rev: number) => void;
  /** Legacy alias for `onRebased` (pre-B2 seam, still emitted). */
  onReconciled?: (doc: EditableDoc, rev: number, droppedCount: number) => void;
  /** §7.3.2 — automatic rebase succeeded; adopt `{ doc, rev }`. */
  onRebased?: (event: RebasedEvent) => void;
  /** §7.3.3 — automatic rebase failed; show the conflict dialog. */
  onConflict?: (event: ConflictEvent) => void;
  /** §14 — one op was rejected with a 422; roll it back locally. */
  onOpRejected?: (event: OpRejectedEvent) => void;
  /**
   * §13/§14 hard limit — a flush was refused because the document body JSON
   * is over the ~1 MB cap (checked ONLY on growth batches, so pure deletes
   * always go through and let the user shrink the document back under the
   * cap). The queue is parked like the offline state; the next enqueue /
   * flushNow / reconnect retries it.
   */
  onLimitExceeded?: (event: LimitExceededEvent) => void;
  /** After any conflict resolution — the UI clears its undo history (§7.3.4). */
  onConflictResolved?: (mode: ConflictMode) => void;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
};

const DEFAULT_DEBOUNCE_MS = 500; // spec §7.1
const DEFAULT_MAX_WAIT_MS = 5_000; // spec §7.1
const DEFAULT_MAX_RETRIES = Number.POSITIVE_INFINITY; // keep retrying every 30 s
const DEFAULT_MAX_RECOVERIES = 3;
/** §22.2: the offline mirror is written (debounced) 100 ms after a change. */
const OFFLINE_SAVE_DEBOUNCE_MS = 100;
/** Spec §7.1 retry backoff: 1 s, 2 s, 5 s, 10 s, then every 30 s. */
const RETRY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000] as const;
const RETRY_STEADY_MS = 30_000;

function backoffMs(retry: number): number {
  if (retry <= 0) return RETRY_BACKOFF_MS[0] as number;
  return retry <= RETRY_BACKOFF_MS.length
    ? (RETRY_BACKOFF_MS[retry - 1] as number)
    : RETRY_STEADY_MS;
}

const defaultIsOnline = (): boolean => {
  if (typeof navigator === "undefined") return true;
  return (navigator as { onLine?: boolean }).onLine !== false;
};

const defaultAddOnlineListener = (cb: () => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => undefined;
  }
  window.addEventListener("online", cb);
  return () => window.removeEventListener("online", cb);
};

/** fetch() network failures surface as TypeError — that's the offline signal. */
function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError;
}

/** §7.3.1 default validity check: block ids must stay unique. */
function defaultValidateDoc(doc: EditableDoc): boolean {
  const seen = new Set<string>();
  const walk = (blocks: readonly Block[]): boolean => {
    for (const block of blocks) {
      if (seen.has(block.id)) return false;
      seen.add(block.id);
      if (block.children && !walk(block.children)) return false;
    }
    return true;
  };
  return walk(doc.body.blocks);
}

export class AutosaveController {
  private readonly transport: DocumentTransport;
  private readonly docId: string;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly maxRetries: number;
  private readonly maxRecoveries: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly offlineQueue: OfflineQueuePort | null;
  private readonly validateDoc: (doc: EditableDoc) => boolean;
  private readonly unsubscribeOnline: () => void;

  private pending: Op[] = [];
  private cancelTimer: (() => void) | null = null;
  private maxWaitCancel: (() => void) | null = null;
  private cancelWait: (() => void) | null = null;
  private queueSaveCancel: (() => void) | null = null;
  private flushing = false;
  private destroyed = false;
  private rev: number;
  private retries = 0;
  private recoveries = 0;
  private lastStatus: AutosaveStatus = "idle";
  private savedAt: number | null = null;
  private conflictCtx: ConflictEvent | null = null;

  constructor(private readonly options: AutosaveOptions) {
    this.transport = options.transport;
    this.docId = options.docId;
    this.rev = options.initialRev;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRecoveries = options.maxRecoveries ?? DEFAULT_MAX_RECOVERIES;
    this.schedule = options.schedule ?? defaultSchedule;
    this.now = options.now ?? (() => Date.now());
    this.isOnline = options.isOnline ?? defaultIsOnline;
    this.offlineQueue = options.offlineQueue ?? null;
    this.validateDoc = options.validateDoc ?? defaultValidateDoc;
    this.unsubscribeOnline = (options.addOnlineListener ?? defaultAddOnlineListener)(() =>
      this.handleOnline(),
    );
  }

  get currentRev(): number {
    return this.rev;
  }

  get status(): AutosaveStatus {
    return this.lastStatus;
  }

  get lastSavedAt(): number | null {
    return this.savedAt;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Snapshot of the unsent ops (for unload guards / beacon flushes). */
  get pendingOps(): readonly Op[] {
    return [...this.pending];
  }

  /** The active conflict (§7.3), if any — the UI can render from it. */
  get conflict(): ConflictEvent | null {
    return this.conflictCtx;
  }

  /** Queue ops for the next (debounced) flush. */
  enqueue(ops: readonly Op[]): void {
    if (this.destroyed || ops.length === 0) return;
    this.pending.push(...ops);
    this.emit("dirty");
    if (this.conflictCtx) {
      // Conflict dialog open: keep collecting edits for "Keep mine", but do
      // not touch the network until the user resolves.
      this.syncQueue();
      return;
    }
    this.scheduleFlush(this.debounceMs);
    // §7.1 max wait: the first unsent op must leave within `maxWaitMs` even
    // if typing keeps resetting the debounce. Not reset by later enqueues.
    if (this.maxWaitCancel === null && !this.flushing) {
      this.maxWaitCancel = this.schedule(() => {
        this.maxWaitCancel = null;
        void this.flush();
      }, this.maxWaitMs);
    }
    this.syncQueue();
  }

  /** Flush immediately, bypassing the debounce (Cmd+S / pagehide). */
  flushNow(): Promise<void> {
    this.cancelDebounce();
    this.cancelMaxWait();
    return this.flush();
  }

  /**
   * Apply the user's choice from the §7.3.3 conflict dialog.
   * - "mine": re-apply the losing ops as a new revision — they are PATCHed
   *   with the server's rev as `baseRev` (overwrites where they collide).
   * - "theirs": drop the local ops and adopt the server document.
   * Either way `onConflictResolved` fires so the UI can clear undo history.
   */
  async resolveConflict(mode: ConflictMode, ctx?: ConflictEvent): Promise<void> {
    const event = ctx ?? this.conflictCtx;
    if (!event || this.destroyed) return;
    this.conflictCtx = null;
    this.retries = 0;
    this.recoveries = 0;

    if (mode === "theirs") {
      this.rev = event.rev;
      this.pending = [];
      const doc =
        event.serverDoc ??
        (event.serverBody
          ? { meta: this.snapshotMeta(), body: event.serverBody }
          : null);
      this.syncQueue(); // §22.2: the offline record is cleared on "Use theirs"
      if (doc) {
        this.adoptServerDoc(doc, event.rev);
      } else {
        // Defensive: no server snapshot captured — refetch once.
        try {
          const fresh = await this.transport.load(this.docId);
          this.rev = fresh.rev;
          this.adoptServerDoc(
            { meta: { title: fresh.title, slug: fresh.slug }, body: fresh.body },
            fresh.rev,
          );
        } catch (err) {
          this.emit("error", err instanceof Error ? err.message : "Could not load the latest changes");
          this.options.onConflictResolved?.("theirs");
          return;
        }
      }
      this.options.onConflictResolved?.("theirs");
      return;
    }

    // "mine": the pending queue already holds the losing ops (plus anything
    // enqueued since); send them against the server's rev.
    this.rev = event.rev;
    this.syncQueue();
    this.options.onConflictResolved?.("mine");
    await this.flushNow();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelDebounce();
    this.cancelMaxWait();
    if (this.cancelWait) {
      this.cancelWait();
      this.cancelWait = null;
    }
    if (this.queueSaveCancel) {
      // Persist the pending mirror before tearing down (pagehide path).
      this.cancelQueuedSave();
      this.saveQueueNow();
    }
    this.unsubscribeOnline();
  }

  private snapshotMeta(): { title: string; slug?: string } {
    return this.options.snapshotDoc?.()?.meta ?? { title: "" };
  }

  private adoptServerDoc(doc: EditableDoc, rev: number): void {
    this.options.onAck?.(rev);
    this.options.onReconciled?.(doc, rev, 0);
    this.options.onRebased?.({ doc, rev, droppedCount: 0 });
    this.emit("saved");
  }

  /** window `online` (§7.1): reconnect → flush the kept queue automatically. */
  private readonly handleOnline = (): void => {
    if (this.destroyed || this.conflictCtx) return;
    this.retries = 0;
    if (this.pending.length > 0) void this.flushNow();
  };

  private scheduleFlush(ms: number): void {
    if (this.destroyed) return;
    this.cancelDebounce();
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      void this.flush();
    }, ms);
  }

  private cancelDebounce(): void {
    if (this.cancelTimer) {
      this.cancelTimer();
      this.cancelTimer = null;
    }
  }

  private cancelMaxWait(): void {
    if (this.maxWaitCancel) {
      this.maxWaitCancel();
      this.maxWaitCancel = null;
    }
  }

  private cancelQueuedSave(): void {
    if (this.queueSaveCancel) {
      this.queueSaveCancel();
      this.queueSaveCancel = null;
    }
  }

  private emit(status: AutosaveStatus, message?: string): void {
    this.lastStatus = status;
    if (status === "saved") this.savedAt = this.now();
    this.options.onStatus?.(status, { at: this.now(), message });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const cancel = this.schedule(resolve, ms);
      this.cancelWait = () => {
        cancel();
        resolve();
      };
    });
  }

  // -------------------------------------------------------------------------
  // §22.2 offline mirror
  // -------------------------------------------------------------------------

  /** Mirror `pending` into the offline queue (debounced 100 ms) or clear it. */
  private syncQueue(): void {
    const queue = this.offlineQueue;
    if (!queue) return;
    if (this.pending.length === 0) {
      if (this.flushing) return; // the flush's finally settles it
      this.cancelQueuedSave();
      void queue.clearQueue(this.docId);
      return;
    }
    this.cancelQueuedSave();
    this.queueSaveCancel = this.schedule(() => {
      this.queueSaveCancel = null;
      this.saveQueueNow();
    }, OFFLINE_SAVE_DEBOUNCE_MS);
  }

  private saveQueueNow(): void {
    this.offlineQueue?.saveQueue({
      docId: this.docId,
      baseRev: this.rev,
      ops: [...this.pending],
      updatedAt: this.now(),
    });
  }

  // -------------------------------------------------------------------------
  // Flush loop (one request in flight at a time)
  // -------------------------------------------------------------------------

  private async flush(): Promise<void> {
    if (this.flushing || this.destroyed || this.conflictCtx) return;
    this.cancelDebounce();
    this.cancelMaxWait();
    this.flushing = true;
    try {
      while (this.pending.length > 0 && !this.destroyed) {
        // §7.1/§7.3 parking: offline, or a conflict awaiting the user's
        // choice. Deliberately NO retry timer is scheduled here — the queue
        // restarts via the `online` event, the next enqueue, `flushNow`, or
        // `resolveConflict`. (Ops that arrive while a request is in flight
        // are drained by this same loop — it only exits with an empty queue.)
        if (!this.isOnline() || this.conflictCtx) {
          if (!this.conflictCtx) this.emit("offline", "Offline — changes are kept on this device");
          return;
        }
        const batch = this.pending.splice(0, this.pending.length);
        // §13/§14 hard limit (follow-up #10): before assembling the PATCH
        // batch, refuse it when the local body is already over the ~1 MB cap
        // AND the batch can grow the document further. The whole-body estimate
        // runs HERE (once per coalesced batch) — never per keystroke (§13).
        // Pure-removal batches always send so the user can delete their way
        // back under the cap. Parking mirrors the §7.1 offline behavior.
        const localDoc = this.options.snapshotDoc?.() ?? null;
        if (localDoc && batchImpliesGrowth(batch) && isBodyOverLimit(localDoc.body)) {
          this.pending.unshift(...batch);
          this.emit(
            "error",
            "Document too large to save — over the 1 MB limit; delete blocks or shorten content",
          );
          this.options.onLimitExceeded?.({ kind: "bytes", chars: estimateBodyJsonChars(localDoc.body) });
          return;
        }
        this.emit("saving");
        let res: PatchResult;
        try {
          res = await this.transport.patch(this.docId, this.rev, batch);
        } catch (err) {
          if (await this.handleFlushError(err, batch)) continue;
          return;
        }
        // Success: adopt the acked rev, drop the ops, reset the retry chain.
        this.rev = res.rev;
        this.retries = 0;
        this.recoveries = 0;
        this.options.onAck?.(res.rev);
        this.emit("saved");
      }
    } finally {
      this.flushing = false;
      this.syncQueue();
    }
  }

  /** Returns true when the flush loop may continue with the remaining ops. */
  private async handleFlushError(err: unknown, batch: readonly Op[]): Promise<boolean> {
    // §14 / §22.1: 422 rejected exactly one op — drop it, keep the rest, retry.
    if (err instanceof OpRejectedError) {
      const idx = err.opIndex;
      if (idx !== null && idx >= 0 && idx < batch.length) {
        const rejected = batch[idx] as Op;
        const rest = batch.filter((_, i) => i !== idx);
        this.pending.unshift(...rest);
        this.options.onOpRejected?.({ op: rejected, index: idx, code: err.code, message: err.message });
        this.emit("dirty");
        return true;
      }
      // No usable index — never guess; fall through to transient handling.
    }

    if (err instanceof ConflictError) {
      return this.handleConflict(err, batch);
    }

    if (isNetworkFailure(err)) {
      // §7.1: fetch failure — keep the queue and wait for reconnect.
      this.pending.unshift(...batch);
      this.emit("offline", "Connection lost — changes are kept on this device");
      return false;
    }

    // Transient failure (5xx / unknown): backoff 1s, 2s, 5s, 10s, 30s… while
    // keeping the pending ops (§7.1).
    this.retries += 1;
    this.pending.unshift(...batch);
    this.emit("error", err instanceof Error ? err.message : "Save failed");
    if (this.retries > this.maxRetries) return false;
    await this.sleep(backoffMs(this.retries));
    return !this.destroyed;
  }

  // -------------------------------------------------------------------------
  // 409 handling (§7.3)
  // -------------------------------------------------------------------------

  /**
   * Automatic rebase: replay the local ops onto the server state. Accepts
   * (and re-sends with the fresh rev) when every op applied cleanly and the
   * result validates; otherwise raises `onConflict` and parks the queue
   * until `resolveConflict`.
   */
  private async handleConflict(conflict: ConflictError, failedBatch: readonly Op[]): Promise<boolean> {
    this.emit("conflict");
    this.recoveries += 1;

    const seenSoFar = [...failedBatch, ...this.pending];

    if (this.recoveries > this.maxRecoveries) {
      this.raiseConflict(conflict.rev, null, conflict.body ?? null, seenSoFar);
      return false;
    }

    // Server state for the rebase. Prefer the 409 body (no round-trip); load
    // the full envelope when it is missing or when meta-bearing ops need the
    // authoritative title/slug.
    let serverRev = conflict.rev;
    let serverBody = conflict.body ?? null;
    let serverDoc: EditableDoc | null = null;
    if (!serverBody || seenSoFar.some((op) => op.op === "meta.update")) {
      try {
        const fresh: DocumentEnvelope = await this.transport.load(this.docId);
        serverRev = fresh.rev;
        serverBody = fresh.body;
        serverDoc = { meta: { title: fresh.title, slug: fresh.slug }, body: fresh.body };
      } catch (loadErr) {
        // Cannot rebase without server state — retry as a transient failure.
        this.pending.unshift(...failedBatch);
        this.retries += 1;
        this.emit(
          "error",
          loadErr instanceof Error ? loadErr.message : "Could not reload the document after a conflict",
        );
        if (this.retries > this.maxRetries) return false;
        await this.sleep(backoffMs(this.retries));
        return !this.destroyed;
      }
    }
    if (!serverDoc && serverBody) {
      serverDoc = { meta: this.snapshotMeta(), body: serverBody };
    }
    if (!serverDoc) {
      // Unreachable with a sane transport (409 always carries rev); be safe.
      this.raiseConflict(conflict.rev, null, null, seenSoFar);
      return false;
    }

    // Ops typed while the recovery request was in flight join the replay.
    const replay = [...failedBatch, ...this.pending];
    const { doc, applied, dropped } = applyOpsBestEffort(serverDoc, replay);
    if (dropped.length === 0 && this.validateDoc(doc)) {
      // §7.3.1–2: silent rebase — adopt the merged doc and re-send.
      this.rev = serverRev;
      this.options.onAck?.(serverRev);
      this.options.onReconciled?.(doc, serverRev, 0);
      this.options.onRebased?.({ doc, rev: serverRev, droppedCount: 0 });
      this.pending = applied;
      this.syncQueue();
      return true;
    }

    // §7.3.3: blocking-but-non-destructive dialog (ConflictDialog, wired).
    this.raiseConflict(serverRev, serverDoc, serverBody, replay);
    return false;
  }

  private raiseConflict(
    rev: number,
    serverDoc: EditableDoc | null,
    serverBody: DocumentBody | null,
    pendingOps: readonly Op[],
  ): void {
    const event: ConflictEvent = { rev, serverDoc, serverBody, pendingOps: [...pendingOps] };
    this.conflictCtx = event;
    this.pending = [...pendingOps];
    this.emit("conflict", "Edited elsewhere — review your changes");
    this.options.onConflict?.(event);
    this.syncQueue();
  }
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

// Re-export so UI code can `instanceof` without importing transport directly.
export { ConflictError, OpRejectedError };
export type { DocumentEnvelope };
