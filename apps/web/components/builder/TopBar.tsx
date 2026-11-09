'use client';

// Top bar (spec §4): back link, inline-editable title, save indicator,
// undo/redo, preview, share, publish control, and (tablet zone only) the
// settings drawer toggle handed in by BuilderShell.
// NEVER renders upgrade prompts (spec §4 / §24).

import { useEffect, useRef, useState, type RefObject } from "react";
import { useBuilder } from "./context";
import { PreviewModal } from "./PreviewModal";
import { PublishControl } from "./PublishControl";
import { SaveIndicator, type SaveStatusStore } from "./save-indicator";

export function TopBar({
  saveStatusStore,
  onToggleSettings,
  settingsOpen = false,
  settingsToggleRef,
  previewOpen: previewOpenProp,
  onPreviewOpenChange,
}: {
  saveStatusStore: SaveStatusStore;
  /** Tablet zone only: BuilderShell passes this to mount the drawer toggle. */
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
  settingsToggleRef?: RefObject<HTMLButtonElement | null>;
  /**
   * Wave-3 lift: when provided, the §8.4 preview modal is CONTROLLED from the
   * page level so "ff:open-preview" (⌘/Ctrl+Shift+P) can open it too.
   * Omitted → the bar keeps its own state (pre-existing behavior/tests).
   */
  previewOpen?: boolean;
  onPreviewOpenChange?: (open: boolean) => void;
}) {
  const { state, dispatch } = useBuilder();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [previewOpenState, setPreviewOpenState] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const title = state.meta.title;

  // Controlled when the page passes previewOpen, self-managed otherwise.
  const previewOpen = previewOpenProp ?? previewOpenState;
  const setPreviewOpen = (open: boolean): void => {
    setPreviewOpenState(open);
    onPreviewOpenChange?.(open);
  };

  const lastUndo = state.history.past[state.history.past.length - 1];
  const lastRedo = state.history.future[state.history.future.length - 1];
  const canUndo = state.history.past.length > 0;
  const canRedo = state.history.future.length > 0;
  const published = state.docStatus === "published";

  // --- inline title edit (spec §4: Enter commits, Esc reverts, empty keeps) -
  const startEdit = () => {
    setDraft(title);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    // "Empty commits the previous title" — an empty draft keeps the current
    // title (no op dispatched), matching the spec without a no-op undo entry.
    const next = draft.trim().length > 0 ? draft : title;
    if (next === title) return;
    dispatch({
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: next } }],
      label: "Rename document",
    });
  };

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const share = () => {
    // Computed in the handler (never at render) so SSR stays window-free.
    const slug = state.meta.slug ?? state.docId;
    const url = `${window.location.origin}/p/${slug}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4" data-testid="builder-topbar">
      <a href="/dashboard" aria-label="Back to dashboard" className="ff-icon-btn" title="Back to dashboard">
        <span aria-hidden="true">←</span>
      </a>

      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false); // Esc reverts
          }}
          aria-label="Document title"
          className="ff-input min-w-0 max-w-80 flex-1 font-semibold"
        />
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={startEdit}
            className="truncate rounded-lg px-2 py-1 text-[0.9375rem] font-semibold tracking-tight transition-colors hover:bg-[color:color-mix(in_srgb,var(--ff-primary)_10%,transparent)]"
            style={{ fontFamily: "var(--ff-font-heading)" }}
            title="Click to rename"
            dir="auto"
          >
            {title || "Untitled"}
          </button>
          {state.save === "dirty" && (
            <span
              className="hidden items-center rounded-full px-2 py-0.5 text-xs font-medium text-[color:var(--ff-warning)] sm:inline-flex"
              style={{
                background: "var(--ff-warning-soft)",
                border: "1px solid color-mix(in srgb, var(--ff-warning) 30%, transparent)",
              }}
              aria-hidden="true"
            >
              Edited
            </span>
          )}
          {/* mono doc-id chip — support/reference only, never the title */}
          <span
            className="hidden max-w-[9rem] truncate md:inline"
            style={{ fontFamily: "var(--ff-font-mono)", fontSize: "0.6875rem", color: "var(--ff-muted)" }}
            title={state.docId}
          >
            {state.docId}
          </span>
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
        <SaveIndicator store={saveStatusStore} />

        <div className="flex items-center gap-1" role="group" aria-label="History">
          <button
            type="button"
            className="ff-icon-btn"
            onClick={() => dispatch({ type: "undo" })}
            disabled={!canUndo}
            title={`Undo${lastUndo?.label ? `: ${lastUndo.label}` : ""}`}
            aria-label="Undo"
          >
            <span aria-hidden="true">↶</span>
          </button>
          <button
            type="button"
            className="ff-icon-btn"
            onClick={() => dispatch({ type: "redo" })}
            disabled={!canRedo}
            title={`Redo${lastRedo?.label ? `: ${lastRedo.label}` : ""}`}
            aria-label="Redo"
          >
            <span aria-hidden="true">↷</span>
          </button>
        </div>

        <button type="button" className="ff-icon-btn" onClick={() => setPreviewOpen(true)}>
          Preview
        </button>
        <button
          type="button"
          className="ff-icon-btn"
          onClick={share}
          disabled={!published}
          title={published ? "Copy the public link" : "Publish to share"}
        >
          {copied ? "Copied" : "Share"}
        </button>

        {/* placement only — PublishControl internals live in PublishControl.tsx */}
        <span
          aria-hidden="true"
          className="mx-0.5 hidden h-5 w-px shrink-0 sm:block"
          style={{ background: "var(--ff-border)" }}
        />

        <PublishControl />

        {onToggleSettings && (
          <button
            ref={settingsToggleRef}
            type="button"
            className="ff-icon-btn"
            onClick={onToggleSettings}
            aria-label="Toggle settings panel"
            aria-expanded={settingsOpen}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        )}
      </div>

      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </div>
  );
}

