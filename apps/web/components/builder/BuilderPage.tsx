'use client';

// Builder page root (spec §4, §8.5): loads the document envelope (mirroring
// LogicBuilder's load flow — ApiTransport with the NEXT_PUBLIC_FF_MOCK_BUILDER
// dev fallback), wires the editor store to AutosaveController and composes
// BuilderShell. The provider lives at page level (see context.tsx NOTE —
// layout-level provider is a follow-up once Logic shares this store).
//
// AUTOSAVE GLUE (wave-3 reference — the exact seams):
//   1. store mutations (apply / undo / redo) set `state.emit = { nonce, ops }`
//   2. the emit effect enqueues a new emit's ops on the controller, then
//      dispatches { type: "emitDone", nonce } so the channel accepts the next
//      batch (a ref guards against handling the same nonce twice)
//   3. controller.onStatus → saveStatusStore.emit (SaveIndicator chip) AND
//      dispatch { type: "saveStatus", status } (store.save / store.savedAt)
//   4. controller.onAck(rev) → dispatch { type: "ackRev", rev } (store.rev)
//   5. controller.onReconciled(doc, rev) → dispatch { type: "reconciled", … }
//      (409 recovery adopt, history reset)
//   6. pagehide → controller.flushNow() (zero data loss on reload, §7.1)

import { useCallback, useEffect, useRef, useState } from "react";
import { AutosaveController } from "@/lib/builder/autosave";
import { createTransport, type DocumentTransport } from "@/lib/builder/transport";
import type { DocumentEnvelope } from "@/lib/bridge";
import { BuilderProvider, useBuilder } from "./context";
import { BuilderShell } from "./BuilderShell";
import type { BannerKind } from "./ContextualBanner";
import { createSaveStatusStore, type SaveStatusStore } from "./save-indicator";

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
  const [bannerKind, setBannerKind] = useState<BannerKind>("none");
  const [retryToken, setRetryToken] = useState(0);
  const transportRef = useRef<DocumentTransport | null>(null);
  const controllerRef = useRef<AutosaveController | null>(null);
  const lastHandledNonceRef = useRef(0);

  // --- load (mirrors LogicBuilder: createTransport + mock dev toggle) -------
  useEffect(() => {
    let disposed = false;
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
        // Multi-tab detection (BroadcastChannel) lands in wave 3 and will
        // upgrade this to kind="multitab" when a second tab holds the doc.
        setBannerKind((envelope.status as string) === "archived" ? "archived" : "none");
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Could not load the document");
      }
    })();
    return () => {
      disposed = true;
    };
  }, [docId, dispatch, loadDocument, retryToken]);

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
      onStatus: (status, info) => {
        saveStatusStore.emit(status, info);
        dispatch({ type: "saveStatus", status, at: info.at });
      },
      onAck: (rev) => dispatch({ type: "ackRev", rev }),
      onReconciled: (doc, rev) => dispatch({ type: "reconciled", doc, rev }),
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

  // --- zero data loss on reload (§7.1, mirrors LogicBuilder) ------------------
  useEffect(() => {
    const onHide = () => {
      void controllerRef.current?.flushNow();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
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

  return <BuilderShell saveStatusStore={saveStatusStore} bannerKind={bannerKind} />;
}
