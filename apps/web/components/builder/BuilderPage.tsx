'use client';

// Builder page root (spec §4, §7, §8.5): loads the document envelope (mirroring
// LogicBuilder's load flow — ApiTransport with the NEXT_PUBLIC_FF_MOCK_BUILDER
// dev fallback), wires the editor store to AutosaveController, composes
// BuilderShell, and mounts EVERY wave-3 overlay exactly once (picker,
// shortcuts help, clipboard chords, undo toast, conflict dialog, restore
// prompt). The provider lives at page level (see context.tsx NOTE —
// layout-level provider is a follow-up once Logic shares this store).
//
// AUTOSAVE GLUE (all live as of wave 3):
//   1. store mutations (apply / undo / redo) set `state.emit = { nonce, ops }`
//   2. the emit effect enqueues a new emit's ops on the controller, then
//      dispatches { type: "emitDone", nonce } (a ref guards double handling)
//   3. controller.onStatus → saveStatusStore.emit AND { type: "saveStatus" }
//   4. controller.onAck → { type: "ackRev", rev } + multitab.announceRev
//   5. controller.onRebased → { type: "reconciled" } (silent 409 rebase adopt,
//      history reset) + multitab.announceRev
//   6. controller.onConflict → ConflictDialog; onOpRejected → shell notice
//   7. pagehide → flushNow; beforeunload → beacon flush + §7.1 guard
//   8. "ff:force-save" → flushNow; "ff:open-preview" → controlled preview
//   9. after load → §7.2 recoverPending → RestorePrompt (restore re-enters
//      through the normal apply path; discard removes the stored record);
//      a STALE batch with ops routes into the §7.3 conflict flow instead
//      (follow-up #2 — same ConflictDialog as a 409; a failed server-doc
//      fetch falls back to the Discard-only prompt)
//  10. §7.4 multitab channel → ContextualBanner kind="multitab"
//
// PICKER DOUBLE-OPEN NOTE: "ff:open-picker" is emitted by LeftPane, canvas
// InsertionRows AND useShortcuts ("/" and ⌘/Ctrl+K). All three flow through
// useBlockPicker's SINGLE window listener, so at worst a duplicate event
// re-anchors the already-open picker — no dedupe needed.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AutosaveController,
  type ConflictEvent,
  type ConflictMode,
  type OpRejectedEvent,
} from "@/lib/builder/autosave";
import { createTransport, type DocumentTransport } from "@/lib/builder/transport";
import type { DocumentEnvelope } from "@/lib/bridge";
import {
  discardPending as discardStoredPending,
  flushViaBeacon,
  recoverPending,
  shouldGuardUnload,
  type PendingBatchRecord,
} from "@/lib/builder/offline";
import { createMultitabChannel, type MultitabChannel } from "@/lib/builder/multitab";
import type { Op } from "@/lib/builder/ops";
import {
  bannerKindFor,
  planRecovery,
  rejectionNoticeText,
  sharedOfflineQueue,
  staleConflictEvent,
} from "@/lib/builder/wiring";
import { BuilderProvider, useBuilder } from "./context";
import { BuilderShell } from "./BuilderShell";
import { BlockPicker } from "./BlockPicker";
import { useBlockPicker } from "./useBlockPicker";
import { SHORTCUT_EVENTS, ShortcutsHelpDialog, useShortcuts } from "./useShortcuts";
import { useClipboardShortcuts } from "./useClipboardShortcuts";
import { UndoToast } from "./UndoToast";
import { ConflictDialog } from "./ConflictDialog";
import { RestorePrompt, type RestoreRequest } from "./RestorePrompt";
import type { BannerKind } from "./ContextualBanner";
import { createSaveStatusStore, type SaveStatusStore } from "./save-indicator";

/** A pending §7.2 recovery: what the prompt shows + the ops Restore applies. */
type RecoveryState = { request: RestoreRequest; ops: readonly Op[] };

export function BuilderPage({
  docId,
  /**
   * Test seam: inject an envelope loader instead of the real transport so
   * component tests never fetch (and never start the autosave loop).
   * Production renders pass nothing.
   */
  loadDocument,
}: {
  docId: string;
  loadDocument?: (docId: string) => Promise<DocumentEnvelope>;
}) {
  // One save-status store per page instance; passed down by props so the
  // builder context stays purely document state.
  const [saveStatusStore] = useState(createSaveStatusStore);
  return (
    <BuilderProvider docId={docId}>
      <BuilderSession docId={docId} saveStatusStore={saveStatusStore} loadDocument={loadDocument} />
    </BuilderProvider>
  );
}

function BuilderSession({
  docId,
  saveStatusStore,
  loadDocument,
}: {
  docId: string;
  saveStatusStore: SaveStatusStore;
  loadDocument?: (docId: string) => Promise<DocumentEnvelope>;
}) {
  const { state, dispatch } = useBuilder();
  const [error, setError] = useState<string | null>(null);
  const [envelopeArchived, setEnvelopeArchived] = useState(false);
  const [multitabSeen, setMultitabSeen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictEvent | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [rejectNotice, setRejectNotice] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const transportRef = useRef<DocumentTransport | null>(null);
  const controllerRef = useRef<AutosaveController | null>(null);
  const channelRef = useRef<MultitabChannel | null>(null);
  const lastHandledNonceRef = useRef(0);

  // Latest-state mirror for callbacks that must read fresh doc data without
  // re-subscribing listeners (snapshotDoc, post-insert focus).
  const latest = useRef({ state });
  latest.current = { state };
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  // The ConflictEvent routed from a stale §22.2 batch (follow-up #2): lets
  // resolveConflict tell a recovery conflict (ops NOT yet applied locally)
  // apart from a live 409 conflict (ops already applied locally).
  const recoveryConflictRef = useRef<ConflictEvent | null>(null);

  // --- wave-3 overlays (mounted ONCE, inside the provider) -------------------
  const picker = useBlockPicker();
  const { helpOpen, closeHelp } = useShortcuts();
  useClipboardShortcuts();

  // --- load (mirrors LogicBuilder: createTransport + mock dev toggle) -------
  useEffect(() => {
    let disposed = false;
    recoveryConflictRef.current = null; // a fresh load invalidates any recovery conflict
    void (async () => {
      try {
        let envelope: DocumentEnvelope;
        if (loadDocument) {
          envelope = await loadDocument(docId);
        } else {
          const transport = createTransport();
          transportRef.current = transport;
          envelope = await transport.load(docId);
        }
        if (disposed) return;
        const mode =
          loadDocument || process.env.NEXT_PUBLIC_FF_MOCK_BUILDER === "1" ? "mock" : "api";
        dispatch({ type: "loaded", envelope, mode });
        // §14: an archived document shows the banner (editing disabled).
        setEnvelopeArchived((envelope.status as string) === "archived");

        // §7.2 recovery: an offline batch may have survived the last session.
        // planRecovery routes it: matching rev → Restore prompt; a stale batch
        // with ops → the §7.3 conflict flow (follow-up #2); a stale empty
        // record → silent discard.
        void (async () => {
          try {
            const found = await recoverPending(docId, envelope.rev, sharedOfflineQueue());
            if (disposed) return;
            const record = found?.record ?? null;
            const plan = planRecovery(record, envelope.rev);
            if (!plan || !found || !record) return;
            // The old §7.2 fallback prompt (fetch failure / no loader seam).
            const offerDiscardStale = (stale: PendingBatchRecord) => {
              setRecovery({
                request: { kind: "discard-stale", editCount: stale.ops.length },
                ops: [],
              });
            };
            if (plan === "conflict") {
              // §7.3 (follow-up #2): a stale batch with ops goes through the
              // SAME conflict flow as a 409 — fetch the current server
              // document and open ConflictDialog (local pending ops vs server
              // doc). If the fetch fails, fall back to the old Discard-only
              // prompt rather than losing the batch.
              const transport = transportRef.current;
              const fetchDoc = loadDocument ?? (transport ? (id: string) => transport.load(id) : null);
              if (!fetchDoc) {
                offerDiscardStale(record);
                return;
              }
              try {
                const fresh = await fetchDoc(docId);
                if (disposed) return;
                const event = staleConflictEvent(record, fresh);
                recoveryConflictRef.current = event;
                setConflict(event);
                // Mirror the §7.3.3 status a live 409 raises.
                const at = Date.now();
                saveStatusStore.emit("conflict", { at, message: "Edited elsewhere — review your changes" });
                dispatch({ type: "saveStatus", status: "conflict", at });
              } catch (err) {
                if (disposed) return;
                console.warn(
                  `[formforge:builder] offline batch for ${docId} was written against rev ${record.baseRev}, ` +
                    `server is at rev ${envelope.rev} and the server document could not be fetched ` +
                    `(${err instanceof Error ? err.message : "unknown error"}) — offering Discard only`,
                );
                offerDiscardStale(record);
              }
              return;
            }
            if (plan === "discard") {
              // A stale record without ops can never apply again — clear it
              // quietly (nothing the user could merge or restore).
              console.warn(
                `[formforge:builder] offline batch for ${docId} was written against rev ${record.baseRev}, ` +
                  `server is at rev ${envelope.rev} and holds no ops — discarding silently`,
              );
              void discardStoredPending(docId, sharedOfflineQueue());
              return;
            }
            setRecovery({
              request: { kind: "restore", editCount: record.ops.length },
              ops: record.ops,
            });
          } catch {
            // Fail-open: recovery is best-effort; the builder works without it.
          }
        })();
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Could not load the document");
      }
    })();
    return () => {
      disposed = true;
    };
  }, [docId, dispatch, loadDocument, retryToken, saveStatusStore]);

  // --- controller lifecycle: created once per loaded document ---------------
  useEffect(() => {
    if (!state.ready) return;
    const transport = transportRef.current;
    if (!transport) return; // injected loader (tests) — no autosave loop
    const controller = new AutosaveController({
      transport,
      docId,
      // state.rev is read once here: from now on the controller owns the live
      // revision (onAck keeps the store in sync).
      initialRev: state.rev,
      // §22.2: pending ops mirror into IndexedDB for crash/reload recovery.
      // Module singleton on globalThis so HMR re-mounts share one queue.
      offlineQueue: sharedOfflineQueue(),
      // Keeps meta (title/slug) correct when rebasing from a bare 409 body.
      snapshotDoc: () => ({ meta: latest.current.state.meta, body: latest.current.state.body }),
      onStatus: (status, info) => {
        saveStatusStore.emit(status, info);
        dispatch({ type: "saveStatus", status, at: info.at });
      },
      onAck: (rev) => {
        dispatch({ type: "ackRev", rev });
        channelRef.current?.announceRev(rev); // §7.4: keep other tabs current
      },
      // §7.3.2 silent rebase adopted — adopt the merged doc + announce.
      onRebased: ({ doc, rev }) => {
        dispatch({ type: "reconciled", doc, rev });
        channelRef.current?.announceRev(rev);
      },
      // §7.3.3 rebase failed — the dialog takes over (queue parked inside
      // the controller; local pending ops stay mirrored to IndexedDB). A
      // live 409 replaces any recovery-routed conflict (follow-up #2).
      onConflict: (event) => {
        recoveryConflictRef.current = null;
        setConflict(event);
      },
      // §14: exactly one op was rolled back — surface a dismissable notice.
      onOpRejected: ({ code, message }: OpRejectedEvent) => {
        console.warn(`[formforge:builder] op rejected by the server (422 ${code}): ${message}`);
        setRejectNotice(rejectionNoticeText({ code, message }));
      },
      // §7.3.4: history was already reset by the `reconciled` dispatch —
      // nothing else to clear here.
      onConflictResolved: () => {},
    });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [state.ready, docId, dispatch, saveStatusStore]);

  // --- store → controller pipe -----------------------------------------------
  useEffect(() => {
    const emit = state.emit;
    if (!emit || emit.nonce === lastHandledNonceRef.current) return;
    lastHandledNonceRef.current = emit.nonce;
    controllerRef.current?.enqueue(emit.ops);
    dispatch({ type: "emitDone", nonce: emit.nonce });
  }, [state.emit, dispatch]);

  // --- §7.4 multitab channel (banner + rev announcements) --------------------
  useEffect(() => {
    // createMultitabChannel posts TAB_OPENED on creation; receiving
    // TAB_OPENED / REV_ACKED from another tab raises the §7.4 banner.
    // BroadcastChannel-less environments get a silent no-op stub.
    const channel = createMultitabChannel(docId);
    channelRef.current = channel;
    const unsubscribe = channel.subscribe(() => setMultitabSeen(true));
    return () => {
      unsubscribe();
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [docId]);

  // --- "ff:force-save" (⌘S / publish 409) + "ff:open-preview" (⌘⇧P) ----------
  useEffect(() => {
    const onForceSave = () => {
      void controllerRef.current?.flushNow();
    };
    const onOpenPreview = () => setPreviewOpen(true);
    window.addEventListener(SHORTCUT_EVENTS.forceSave, onForceSave);
    window.addEventListener(SHORTCUT_EVENTS.openPreview, onOpenPreview);
    return () => {
      window.removeEventListener(SHORTCUT_EVENTS.forceSave, onForceSave);
      window.removeEventListener(SHORTCUT_EVENTS.openPreview, onOpenPreview);
    };
  }, []);

  // --- zero data loss on reload (§7.1) ----------------------------------------
  useEffect(() => {
    // pagehide: flush through the normal transport (controller still alive).
    const onHide = () => {
      void controllerRef.current?.flushNow();
    };
    // beforeunload: best-effort beacon flush first, then the §7.1 guard —
    // but only when there are unsent ops (shouldGuardUnload).
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const controller = controllerRef.current;
      if (!controller || !shouldGuardUnload(controller.pendingCount)) return;
      void flushViaBeacon(docId, {
        baseRev: controller.currentRev,
        ops: controller.pendingOps,
      });
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [docId]);

  // --- wave-3 overlay callbacks ------------------------------------------------
  const resolveConflict = useCallback(
    (mode: ConflictMode) => {
      const recoveryEvent = recoveryConflictRef.current;
      recoveryConflictRef.current = null;
      setConflict(null);
      if (!recoveryEvent) {
        void controllerRef.current?.resolveConflict(mode);
        return;
      }
      // §7.2→§7.3 recovery conflict (follow-up #2): the controller never saw
      // these ops, so resolution differs slightly from a live 409.
      if (mode === "mine") {
        // "Keep mine": the 409 flow's pending ops are already applied
        // locally — a recovered batch is not. Apply through the NORMAL store
        // path (same as §7.2 Restore): the emit wiring enqueues the ops, the
        // controller sends them against its rev, and a mid-flight 409 runs
        // the controller's own §7.3 rebase/dialog. The stored record clears
        // on the ack — never before the ops are safely on the server.
        dispatch({ type: "apply", ops: [...recoveryEvent.pendingOps], label: "Restore unsaved changes" });
        return;
      }
      // "Use theirs": drop the stored batch (§7.2 Discard) and, when the
      // autosave loop is live, adopt the fetched server document + align the
      // controller rev through the SAME resolveConflict path a 409 uses.
      void discardStoredPending(docId, sharedOfflineQueue());
      void controllerRef.current?.resolveConflict("theirs", recoveryEvent);
    },
    [dispatch, docId],
  );

  const restorePending = useCallback(() => {
    const current = recoveryRef.current;
    setRecovery(null);
    // §7.2: the ops re-enter through the NORMAL apply path — the emit wiring
    // enqueues them on the controller and the controller's own ack clears the
    // stored record. (Calling controller.enqueue directly would send ops the
    // local document never applied.)
    if (current && current.request.kind === "restore" && current.ops.length > 0) {
      dispatch({ type: "apply", ops: [...current.ops], label: "Restore unsaved changes" });
    }
  }, [dispatch]);

  const discardRecovery = useCallback(() => {
    setRecovery(null);
    void discardStoredPending(docId, sharedOfflineQueue());
  }, [docId]);

  // Post-insert focus: after the picker's insert commits and React flushes,
  // move focus to the new card (§6.1 follow-up — keyboard insert stays fluid).
  const focusInserted = useCallback(() => {
    requestAnimationFrame(() => {
      if (typeof document === "undefined") return;
      const id = latest.current.state.selection;
      if (!id) return;
      document.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.focus();
    });
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setRetryToken((t) => t + 1);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6">
        <div
          className="max-w-md rounded-2xl border border-red-300 bg-red-50 p-6 text-sm text-red-800"
          role="alert"
        >
          <p className="m-0 font-semibold">The builder could not load</p>
          <p className="mt-1">{error}</p>
          <p className="mt-2 text-xs text-red-700">
            Set NEXT_PUBLIC_FF_MOCK_BUILDER=1 for the in-memory dev document.
          </p>
          <button type="button" className="ff-icon-btn mt-3" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!state.ready) {
    return (
      <div
        className="flex min-h-[100dvh] flex-col items-center justify-center gap-3"
        aria-live="polite"
        aria-busy="true"
      >
        <span
          className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ff-border)] border-t-[color:var(--ff-primary)]"
          aria-hidden="true"
        />
        <p className="m-0 text-sm text-[color:var(--ff-muted)]">Loading editor…</p>
      </div>
    );
  }

  // §14 archived wins over §7.4 multitab (editing is disabled either way).
  const banner: BannerKind = bannerKindFor(envelopeArchived, multitabSeen);

  return (
    <>
      <BuilderShell
        saveStatusStore={saveStatusStore}
        bannerKind={banner}
        notice={rejectNotice}
        onNoticeDismiss={() => setRejectNotice(null)}
        previewOpen={previewOpen}
        onPreviewOpenChange={setPreviewOpen}
      />

      {/* Wave-3 overlays — mounted exactly once (single listeners live in
          useBlockPicker / useShortcuts / UndoToast). */}
      <BlockPicker
        open={picker.open}
        insertAt={picker.insertAt}
        onClose={picker.close}
        onInsert={focusInserted}
      />
      <ShortcutsHelpDialog open={helpOpen} onClose={closeHelp} />
      <UndoToast />
      <ConflictDialog conflict={conflict} onResolve={resolveConflict} />
      <RestorePrompt
        request={recovery?.request ?? null}
        onRestore={restorePending}
        onDiscard={discardRecovery}
      />
    </>
  );
}
