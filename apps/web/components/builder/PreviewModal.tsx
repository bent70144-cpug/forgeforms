'use client';

// PreviewModal — the §8.4 draft preview: the REAL conversational renderer
// (@formforge/renderer) running against the CURRENT DRAFT (never the published
// snapshot — §8.4 "loads the draft as of now"), inside a controlled modal
// mounted by TopBar (same `PreviewModal({open, onClose})` contract as wave 1).
//
// §8.4 checklist:
// - "Draft preview" label + amber DRAFT chip (preview is always the draft);
// - device toggle (Desktop | Mobile segmented, aria-pressed) with a 390px
//   phone frame for mobile;
// - editable prefill URL params in the toolbar → parsed with
//   parsePrefillParams → renderer `urlParams` (§7.2 prefillParam prefill);
// - Restart remounts the renderer via a key increment;
// - sandbox ingest: createMockIngestClient — submissions are NEVER stored
//   (client-side mock; logic rules still run for real inside the renderer);
// - Open live link only when the doc is published and has a slug;
// - close via ×, Escape or backdrop click; focus returns to the trigger.
//
// §13 lazy-loading: the heavy conversational bundle is pulled in with a
// single next/dynamic(ssr:false) import — it never enters the builder route
// chunk. The SAME dynamic module provides the mock ingest client, so nothing
// else from `@formforge/renderer/conversational` is imported at runtime here.

import dynamic from "next/dynamic";
import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import type { ConversationalRendererProps } from "@formforge/renderer/conversational";
import {
  buildPreviewInput,
  PREVIEW_DEVICE_WIDTHS,
} from "@/lib/builder/preview";
import { useBuilder } from "./context";
import { usePreviewSession } from "./usePreviewSession";

/** Props the dynamic surface takes; `ingest` is wired to the sandbox mock. */
type PreviewSurfaceProps = Omit<ConversationalRendererProps, "ingest"> & {
  /** Per-session id: a fresh mock client per Restart so no calls leak across sessions. */
  sessionKey: number;
};

const PreviewSurface = dynamic(
  () =>
    import("@formforge/renderer/conversational").then((mod) => {
      function ConversationalPreviewSurface({ sessionKey, ...props }: PreviewSurfaceProps) {
        // §8.4 sandbox: mock ingest; the renderer's own answer/submit pipeline
        // (and its real logic rules) run against it, but nothing ever reaches
        // the server. Fresh client per session — the same lifetime production
        // gives createFetchIngestClient (one per page view); Restart remounts
        // this surface, so calls never leak across sessions.
        const ingest = useMemo(() => mod.createMockIngestClient(), [sessionKey]);
        return <mod.ConversationalRenderer {...props} ingest={ingest} />;
      }
      return ConversationalPreviewSurface;
    }),
  {
    ssr: false,
    loading: () => (
      <div className="ff-prev-loading" role="status">
        <span className="ff-prev-spinner" aria-hidden="true" />
        Loading preview…
      </div>
    ),
  },
);

/** Backdrop click closes only when the press lands on the overlay itself. */
function onOverlayMouseDown(onClose: () => void) {
  return (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
}

export function PreviewModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state } = useBuilder();
  const session = usePreviewSession(open, onClose);

  // §8.4: the preview shows the draft AS OF NOW — recompute when the draft
  // (or the applied prefill params) change while the modal is open.
  const input = useMemo(
    () => buildPreviewInput(state.body, state.meta, session.appliedParams),
    [state.body, state.meta, session.appliedParams],
  );

  // Hooks stay unconditional; the closed render is a null after them.
  if (!open) return null;

  const showLive = state.docStatus === "published" && Boolean(state.meta.slug);
  const deviceWidth = PREVIEW_DEVICE_WIDTHS[session.device];
  const isMobile = session.device === "mobile";

  return (
    <div className="ff-prev-overlay" data-testid="preview-modal" onMouseDown={onOverlayMouseDown(onClose)}>
      <div
        ref={session.panelRef}
        className="ff-prev-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Draft preview"
        tabIndex={-1}
      >
        <header className="ff-prev-header">
          <div className="ff-prev-title">
            <h2 className="ff-prev-title-text">Draft preview</h2>
            <span className="ff-prev-chip-draft" title="Previewing the current draft, not the published snapshot">
              DRAFT
            </span>
          </div>

          <div className="ff-prev-tools">
            {showLive && (
              <a
                href={`/p/${state.meta.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ff-prev-live-link"
                data-testid="preview-live-link"
              >
                Open live
              </a>
            )}

            <div className="ff-prev-seg" role="group" aria-label="Preview device">
              <button
                type="button"
                aria-pressed={!isMobile}
                onClick={() => session.setDevice("desktop")}
                data-testid="preview-device-desktop"
              >
                Desktop
              </button>
              <button
                type="button"
                aria-pressed={isMobile}
                onClick={() => session.setDevice("mobile")}
                data-testid="preview-device-mobile"
              >
                Mobile
              </button>
            </div>

            <div className="ff-prev-params">
              <input
                type="text"
                className="ff-prev-params-input bg-[color:var(--ff-glass)]! backdrop-blur-md"
                aria-label="Prefill URL params"
                placeholder="?email=test@x.io&name=Ada"
                value={session.paramsText}
                onChange={(event) => session.setParamsText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    session.applyParams();
                  }
                }}
                data-testid="preview-params-input"
              />
              <button
                type="button"
                className="ff-prev-params-apply"
                onClick={session.applyParams}
                data-testid="preview-params-apply"
              >
                Apply
              </button>
            </div>

            <button
              type="button"
              className="ff-prev-tool-btn"
              onClick={session.restart}
              data-testid="preview-restart"
              title="Restart the preview from the first screen"
            >
              Restart
            </button>
            <button
              type="button"
              className="ff-prev-tool-btn"
              onClick={onClose}
              data-testid="preview-close"
            >
              Close
              <span className="ff-prev-close-x" aria-hidden="true">
                ×
              </span>
            </button>
          </div>

          {Object.keys(session.appliedParams).length > 0 && (
            <div className="ff-prev-chips" aria-label="Applied prefill params">
              {Object.entries(session.appliedParams).map(([key, value]) => (
                <span className="ff-prev-chip" key={key} data-testid="preview-param-chip">
                  <span>
                    {key}={value}
                  </span>
                  <button
                    type="button"
                    className="ff-prev-chip-x"
                    aria-label={`Remove param ${key}`}
                    onClick={() => session.removeParam(key)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="ff-prev-body">
          <div className="ff-prev-stage">
            {/* Restart = remount: the key increment discards the renderer's
                internal machine state (§8.4) and starts a fresh ingest session. */}
            <div
              key={session.restartNonce}
              className={isMobile ? "ff-prev-frame ff-prev-frame--mobile" : "ff-prev-frame"}
              style={deviceWidth !== null ? { width: deviceWidth } : undefined}
            >
              <div className="ff-prev-frame-inner">
                <PreviewSurface
                  sessionKey={session.restartNonce}
                  documentId={input.documentId}
                  document={input.document}
                  urlParams={input.urlParams}
                  // Negative delay disables the ending auto-redirect entirely
                  // (EndingScreen treats <0 as "off"): a preview must never
                  // navigate the builder away; the manual link still renders.
                  redirectDelayMs={-1}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
