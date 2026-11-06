'use client';

// Contextual banner slot (spec §7.4 multi-tab, §14 archived document).
// Prop-driven: BuilderPage computes `kind` from the loaded envelope. Multi-tab
// detection itself (BroadcastChannel "ff-doc-<id>") lands in wave 3 — it only
// needs to pass kind="multitab" to render the required banner.

export type BannerKind = "archived" | "multitab" | "none";

export function ContextualBanner({
  kind,
  onRestore,
}: {
  kind: BannerKind;
  /** Archived documents only: shows a Restore action when provided (§14). */
  onRestore?: () => void;
}) {
  if (kind === "none") return null;

  if (kind === "multitab") {
    return (
      <p
        role="status"
        data-testid="multitab-banner"
        className="ff-pane--bottom border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
      >
        Open in another tab — edits there may conflict
      </p>
    );
  }

  return (
    <div
      role="alert"
      data-testid="archived-banner"
      className="ff-pane--bottom flex flex-wrap items-center gap-x-3 gap-y-1 border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <span className="font-semibold">This form was archived</span>
      <span>Editing is disabled — restore the form to keep editing.</span>
      {onRestore && (
        <button type="button" className="ff-icon-btn ml-auto" onClick={onRestore}>
          Restore
        </button>
      )}
    </div>
  );
}
