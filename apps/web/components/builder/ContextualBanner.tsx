'use client';

// Contextual banner slot (spec §7.4 multi-tab, §14 archived document).
// Prop-driven: BuilderPage computes `kind` — "archived" from the loaded
// envelope, upgraded to "multitab" by the §7.4 BroadcastChannel wiring
// (createMultitabChannel in BuilderPage; archived always wins).
//
// Meridian chrome (2026 restyle): a quiet recessed strip on --ff-bg-2 with a
// 3px left rule — ultramarine for the multitab notice, warning amber for the
// archived alert — and a quiet dismiss icon-button (session-local, purely
// presentational; it never mutates the document or the save state).

import { useState } from "react";
import { BTN_SECONDARY_SM } from "@/lib/ui";

export type BannerKind = "archived" | "multitab" | "none";

/** Shared strip: recessed well + hairline + 3px semantic left rule. */
const STRIP =
  "mx-3 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[color:var(--ff-border)] " +
  "px-3 py-2 text-sm shadow-[var(--ff-shadow-sm)]";

export function ContextualBanner({
  kind,
  onRestore,
}: {
  kind: BannerKind;
  /** Archived documents only: shows a Restore action when provided (§14). */
  onRestore?: () => void;
}) {
  // Quiet dismiss — hides the strip for this session only (visual concern).
  const [dismissed, setDismissed] = useState(false);

  if (kind === "none" || dismissed) return null;

  const ruleColor =
    kind === "multitab" ? "var(--ff-primary)" : "var(--ff-warning)";

  if (kind === "multitab") {
    return (
      <p
        role="status"
        data-testid="multitab-banner"
        className={STRIP}
        style={{ borderLeft: `3px solid ${ruleColor}`, background: "var(--ff-bg-2)" }}
      >
        Open in another tab — edits there may conflict
        <button
          type="button"
          className="ff-icon-btn ml-auto shrink-0"
          aria-label="Dismiss notice"
          onClick={() => setDismissed(true)}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </p>
    );
  }

  return (
    <div
      role="alert"
      data-testid="archived-banner"
      className={STRIP}
      style={{ borderLeft: `3px solid ${ruleColor}`, background: "var(--ff-bg-2)" }}
    >
      <span className="font-semibold">This form was archived</span>
      <span>Editing is disabled — restore the form to keep editing.</span>
      {onRestore && (
        <button type="button" className={`${BTN_SECONDARY_SM} ml-auto`} onClick={onRestore}>
          Restore
        </button>
      )}
      <button
        type="button"
        className={`ff-icon-btn shrink-0 ${onRestore ? "" : "ml-auto"}`}
        aria-label="Dismiss notice"
        onClick={() => setDismissed(true)}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
