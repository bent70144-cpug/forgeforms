"use client";

// Client shell for the embed iframe (/embed/:docId).
// Owns the child side of the postMessage height protocol (spec §10.2):
//   - announces itself with `ff:ready`
//   - measures its content with ResizeObserver and posts `ff:height`
//   - answers `ff:request-height` pings from the loader
// The actual document renderer (conversational/scroll, M3+) will mount inside this
// shell and can reuse `postToParent` + `notifyComplete` from ./protocol.
import { useCallback, useEffect, useRef } from "react";

import { isRequestHeightMessage, postToParent } from "./protocol";
import type { Block } from "@formforge/core/templates";

export type EmbedSnapshot = {
  documentId: string;
  title: string;
  type: "form" | "page" | "portfolio";
  blocks: Block[];
};

const QUESTION_KINDS = new Set([
  "short-text",
  "long-text",
  "email",
  "number",
  "single-select",
  "multi-select",
  "dropdown",
  "rating",
  "nps",
  "file-upload",
]);

function labelOf(b: Block): string {
  const v = b.props["label"];
  return typeof v === "string" ? v : "";
}

/** Fire-and-forget completion hook for the renderer: forwards the submission token up. */
export function notifyComplete(submissionToken: string): void {
  postToParent({ type: "ff:complete", submissionToken });
}

export default function EmbedClient({
  docId,
  snapshot,
  transparent,
}: {
  docId: string;
  snapshot: EmbedSnapshot | null;
  transparent: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const postHeight = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const value = Math.ceil(el.getBoundingClientRect().height);
    if (value > 0) postToParent({ type: "ff:height", value });
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    postToParent({ type: "ff:ready" });
    // Two frames so fonts/layout settle before the first measurement.
    const raf = requestAnimationFrame(() => requestAnimationFrame(postHeight));

    const observer = new ResizeObserver(() => postHeight());
    observer.observe(el);

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent) return;
      if (isRequestHeightMessage(event.data)) postHeight();
    };
    window.addEventListener("message", onMessage);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("message", onMessage);
    };
  }, [postHeight]);

  return (
    <div
      ref={rootRef}
      className={`w-full ${transparent ? "bg-transparent p-0" : "bg-white p-4 sm:p-6"}`}
    >
      {snapshot ? (
        <EmbedSnapshotView snapshot={snapshot} />
      ) : (
        <UnavailableView docId={docId} />
      )}
    </div>
  );
}

// SPEC-NOTE: minimal read-only snapshot view. The product-grade conversational
// renderer (M3, @formforge/renderer) replaces this component at integration time;
// the height/postMessage shell above is the durable part of this page.
function EmbedSnapshotView({ snapshot }: { snapshot: EmbedSnapshot }) {
  const questionBlocks = snapshot.blocks.filter((b) => QUESTION_KINDS.has(b.kind) && !b.hidden);
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{snapshot.title}</h1>
        <p className="mt-1 text-xs text-slate-500">Powered by FormForge</p>
      </header>
      {questionBlocks.map((b) => (
        <div key={b.id}>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={`ff-${b.id}`}>
            {labelOf(b) || "(question)"}
          </label>
          <input
            id={`ff-${b.id}`}
            disabled
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            placeholder={b.kind}
          />
        </div>
      ))}
      {questionBlocks.length === 0 && (
        <p className="text-sm text-slate-500">This document has no interactive questions.</p>
      )}
    </div>
  );
}

function UnavailableView({ docId }: { docId: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <p className="text-4xl" aria-hidden>📄</p>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">Nothing to embed — yet</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        The document <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{docId}</code> has no
        published snapshot. Publish it in FormForge and this frame will render it automatically.
      </p>
    </div>
  );
}
