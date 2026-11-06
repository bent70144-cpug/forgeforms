// Autosave queue (spec §8 "Autosave (authoring)").
//
// - Debounces edits (default 500 ms) and serializes PATCH requests — one
//   in-flight request at a time, remaining ops drain in subsequent batches.
// - Sends `{ baseRev, ops }` per spec §11; on `409 CONFLICT` it reloads the
//   server document, replays the unsent ops best-effort onto the fresh body,
//   adopts the result locally (zero data loss) and re-sends with the fresh rev.
// - Retries transient failures (network / 5xx) with exponential backoff.
//
// Framework-agnostic and dependency-injected (`schedule`, `now`) so the whole
// state machine is testable with fake timers and scripted transports.

import type { DocumentEnvelope } from "../bridge";
import { applyOpsBestEffort, type EditableDoc, type Op } from "./ops";
import { ConflictError, type DocumentTransport } from "./transport";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type StatusInfo = { at: number; message?: string };

export type AutosaveOptions = {
  transport: DocumentTransport;
  docId: string;
  initialRev: number;
  /** Trailing debounce before a flush (spec §8: 500 ms). */
  debounceMs?: number;
  /** Transient (network/5xx) retries per batch before surfacing an error. */
  maxRetries?: number;
  /** 409 recoveries within one flush chain before giving up. */
  maxRecoveries?: number;
  onStatus?: (status: AutosaveStatus, info: StatusInfo) => void;
  onAck?: (rev: number) => void;
  /** After a 409 recovery replaced the local document. */
  onReconciled?: (doc: EditableDoc, rev: number, droppedCount: number) => void;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
};

const DEFAULT_DEBOUNCE_MS = 500; // spec §8
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_RECOVERIES = 3;

export class AutosaveController {
  private readonly transport: DocumentTransport;
  private readonly docId: string;
  private readonly debounceMs: number;
  private readonly maxRetries: number;
  private readonly maxRecoveries: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly now: () => number;

  private pending: Op[] = [];
  private cancelTimer: (() => void) | null = null;
  private flushing = false;
  private destroyed = false;
  private rev: number;
  private retries = 0;
  private recoveries = 0;
  private lastStatus: AutosaveStatus = "idle";
  private savedAt: number | null = null;

  constructor(private readonly options: AutosaveOptions) {
    this.transport = options.transport;
    this.docId = options.docId;
    this.rev = options.initialRev;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRecoveries = options.maxRecoveries ?? DEFAULT_MAX_RECOVERIES;
    this.schedule = options.schedule ?? defaultSchedule;
    this.now = options.now ?? (() => Date.now());
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

  /** Queue ops for the next (debounced) flush. */
  enqueue(ops: readonly Op[]): void {
    if (this.destroyed || ops.length === 0) return;
    this.pending.push(...ops);
    this.emit("dirty");
    this.scheduleFlush(this.debounceMs);
  }

  /** Flush immediately, bypassing the debounce (used on pagehide). */
  flushNow(): Promise<void> {
    if (this.cancelTimer) {
      this.cancelTimer();
      this.cancelTimer = null;
    }
    return this.flush();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.cancelTimer) {
      this.cancelTimer();
      this.cancelTimer = null;
    }
  }

  private scheduleFlush(ms: number): void {
    if (this.destroyed) return;
    if (this.cancelTimer) this.cancelTimer();
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      void this.flush();
    }, ms);
  }

  private emit(status: AutosaveStatus, message?: string): void {
    this.lastStatus = status;
    if (status === "saved") this.savedAt = this.now();
    this.options.onStatus?.(status, { at: this.now(), message });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.schedule(resolve, ms);
    });
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.destroyed) return;
    this.flushing = true;
    try {
      while (this.pending.length > 0 && !this.destroyed) {
        const batch = this.pending.splice(0, this.pending.length);
        this.emit("saving");
        try {
          const res = await this.transport.patch(this.docId, this.rev, batch);
          this.rev = res.rev;
          this.retries = 0;
          this.recoveries = 0;
          this.options.onAck?.(res.rev);
          this.emit("saved");
        } catch (err) {
          if (err instanceof ConflictError) {
            this.recoveries += 1;
            if (this.recoveries > this.maxRecoveries) {
              this.pending.unshift(...batch);
              this.emit("error", "Too many conflicting edits — reload from the server");
              return;
            }
            const ok = await this.tryRecover(batch);
            if (!ok) {
              this.retries += 1;
              if (this.retries > this.maxRetries) {
                this.emit("error", "Could not reload the document after a conflict");
                return;
              }
              await this.sleep(backoffMs(this.retries));
            }
            continue;
          }
          // Transient failure: retry the same batch with backoff.
          this.retries += 1;
          this.pending.unshift(...batch);
          if (this.retries > this.maxRetries) {
            this.emit("error", err instanceof Error ? err.message : "Save failed");
            return;
          }
          this.emit("dirty");
          await this.sleep(backoffMs(this.retries));
        }
      }
    } finally {
      this.flushing = false;
      // If ops arrived while we were flushing, keep draining.
      if (this.pending.length > 0 && !this.destroyed && !this.cancelTimer) {
        this.scheduleFlush(0);
      }
    }
  }

  /**
   * 409 recovery (spec §8): refetch, re-apply unsent ops best-effort, adopt
   * the merged document locally, and re-queue the surviving ops so they are
   * sent to the server with the fresh rev.
   */
  private async tryRecover(failedBatch: readonly Op[]): Promise<boolean> {
    this.emit("conflict");
    try {
      const fresh = await this.transport.load(this.docId);
      const rest = this.pending.splice(0, this.pending.length);
      const replay = [...failedBatch, ...rest];
      const { doc, dropped } = applyOpsBestEffort(
        { meta: { title: fresh.title, slug: fresh.slug }, body: fresh.body },
        replay,
      );
      this.rev = fresh.rev;
      this.options.onAck?.(fresh.rev);
      this.options.onReconciled?.(doc, fresh.rev, dropped.length);
      const kept = replay.filter((op) => !dropped.some((d) => d.op === op));
      this.pending = kept;
      if (kept.length === 0) this.emit("saved");
      return true;
    } catch {
      this.pending.unshift(...failedBatch);
      return false;
    }
  }
}

function backoffMs(retry: number): number {
  return 500 * 2 ** (retry - 1);
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

// Re-export so UI code can `instanceof` without importing transport directly.
export { ConflictError };
export type { DocumentEnvelope };
