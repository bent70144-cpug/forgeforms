"use client";

// Client shell for the embed iframe (/embed/:docId).
// Owns the child side of the postMessage height protocol (spec §10.2):
//   - announces itself with `ff:ready`
//   - measures its content with ResizeObserver and posts `ff:height`
//   - answers `ff:request-height` pings from the loader
// The actual document renderer (conversational/scroll, M3+) will mount inside this
// shell and can reuse `postToParent` + `notifyComplete` from ./protocol.
import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { isRequestHeightMessage, postToParent } from "./protocol";
import type { Block } from "@formforge/core/templates";
import { Icon } from "@/components/ui/icons";
import { INPUT } from "@/lib/ui";
import { ReportAbuseLink } from "@/components/public/report-abuse-link";

export type EmbedSnapshot = {
  documentId: string;
  title: string;
  type: "form" | "page" | "portfolio";
  blocks: Block[];
};

// Embeds render inside host pages we don't control, so the widget must stay
// NEUTRAL and LIGHT: these are the Meridian light-theme values from
// app/globals.css re-pinned on the embed subtree, so a dark host OS theme
// never dark-flips the widget itself. Styling only — no behavioural effect.
const LIGHT_TOKEN_PIN = {
  "--ff-bg": "#f7f5f0",
  "--ff-bg-2": "#efece4",
  "--ff-card": "#ffffff",
  "--ff-fg": "#1a1d26",
  "--ff-muted": "#686e7e",
  "--ff-border": "#e5e1d6",
  "--ff-border-strong": "#d1ccbd",
  "--ff-primary": "#3d3bf3",
  "--ff-primary-2": "#2b29c7",
  "--ff-primary-fg": "#ffffff",
  "--ff-accent": "#c2410c",
  "--ff-accent-soft": "#ea580c",
  "--ff-accent-fg": "#ffffff",
  "--ff-radius": "0.875rem",
  "--ff-shadow-sm": "0 1px 2px rgb(26 29 38 / 0.06)",
  "--ff-shadow-md": "0 1px 2px rgb(26 29 38 / 0.06), 0 12px 32px -16px rgb(26 29 38 / 0.16)",
} as const;

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
      style={LIGHT_TOKEN_PIN as CSSProperties}
      className={`w-full ${transparent ? "bg-transparent p-0" : "bg-[var(--ff-card)] p-4 sm:p-6"}`}
    >
      {snapshot ? (
        <EmbedSnapshotView snapshot={snapshot} />
      ) : (
        <UnavailableView docId={docId} />
      )}
      {/* T29 (spec §17): the Report-abuse link rides on EVERY public page —
          embedded documents included (opens in a new tab outside the iframe). */}
      <p className="mt-3 text-right text-[12px] text-[var(--ff-muted)] [&_a]:text-[var(--ff-muted)] [&_a]:underline-offset-2 [&_a:hover]:text-[var(--ff-fg)]">
        <ReportAbuseLink documentRef={docId} />
      </p>
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
        <h1
          className="text-xl font-semibold tracking-tight text-[var(--ff-fg)]"
          style={{ fontFamily: "var(--ff-font-heading)" }}
        >
          {snapshot.title}
        </h1>
      </header>
      {questionBlocks.map((b) => (
        <div key={b.id}>
          <label className="mb-1 block text-sm font-medium text-[var(--ff-fg)]" htmlFor={`ff-${b.id}`}>
            {labelOf(b) || "(question)"}
          </label>
          <input
            id={`ff-${b.id}`}
            disabled
            className={`${INPUT} w-full`}
            placeholder={b.kind}
          />
        </div>
      ))}
      {questionBlocks.length === 0 && (
        <p className="text-sm leading-relaxed text-[var(--ff-muted)]">
          This document has no interactive questions.
        </p>
      )}
      <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ff-muted)]">Powered by FormForge</p>
    </div>
  );
}

function UnavailableView({ docId }: { docId: string }) {
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-center gap-1.5">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-md"
          style={{ background: "var(--ff-primary)", color: "var(--ff-primary-fg)" }}
        >
          <svg
            viewBox="0 0 24 24"
            width={10}
            height={10}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
          </svg>
        </span>
        <span className="text-sm font-semibold tracking-tight text-[var(--ff-fg)]">FormForge</span>
      </div>

      <div className="ff-panel p-6">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--ff-border)] bg-[var(--ff-bg-2)] text-[var(--ff-muted)]"
        >
          <Icon name="fileText" size={18} />
        </span>
        <h1
          className="mt-4 text-base font-semibold tracking-tight text-[var(--ff-fg)]"
          style={{ fontFamily: "var(--ff-font-heading)" }}
        >
          Preview unavailable
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
          The document{" "}
          <code className="rounded-[4px] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--ff-fg)]">
            {docId}
          </code>{" "}
          has no published snapshot. Publish it in FormForge and this frame will render it automatically.
        </p>
        {/* Clearly decorative placeholders — the real renderer mounts here once
            the document is published. Not focusable, hidden from a11y trees. */}
        <div className="mt-5 space-y-2" aria-hidden="true">
          <div className={`${INPUT} opacity-60`} style={{ borderStyle: "dashed" }} />
          <div className={`${INPUT} opacity-60`} style={{ borderStyle: "dashed" }} />
          <div className={`${INPUT} w-2/3 opacity-60`} style={{ borderStyle: "dashed" }} />
        </div>
      </div>
    </div>
  );
}
