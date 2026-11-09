'use client';

// Contextual banner slot (spec §7.4 multi-tab, §14 archived document).
// Prop-driven: BuilderPage computes `kind` — "archived" from the loaded
// envelope, upgraded to "multitab" by the §7.4 BroadcastChannel wiring
// (createMultitabChannel in BuilderPage; archived always wins).
//
// Aurora-glass chrome: both kinds ride the shared .ff-banner recipe with the
// warning semantic tint (amber on both schemes); the banner floats just
// under the glass top bar as a slim card.

import { BTN_SECONDARY_SM } from "@/lib/ui";

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
        className="ff-banner ff-banner-warning mx-3 mt-2"
        style={{ boxShadow: "var(--ff-shadow-sm)" }}
      >
        Open in another tab — edits there may conflict
      </p>
    );
  }

  return (
    <div
      role="alert"
      data-testid="archived-banner"
      className="ff-banner ff-banner-warning mx-3 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{ boxShadow: "var(--ff-shadow-sm)" }}
    >
      <span className="font-semibold">This form was archived</span>
      <span>Editing is disabled — restore the form to keep editing.</span>
      {onRestore && (
        <button type="button" className={`${BTN_SECONDARY_SM} ml-auto`} onClick={onRestore}>
          Restore
        </button>
      )}
    </div>
  );
}
