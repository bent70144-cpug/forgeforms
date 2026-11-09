// T15 — semantic status pill, rebuilt on the design-system badge tokens:
// completed → BADGE_POSITIVE, draft → BADGE_WARNING, spam → BADGE_DANGER.
// Every hue comes from --ff-success/--ff-warning/--ff-danger via the shared
// .ff-badge recipes, so the light scheme flips automatically — no raw Tailwind
// colors, no dark: variants. The leading 6px dot inherits the hue (bg-current).

import type { SubmissionStatus } from "../../lib/results";
import { BADGE_DANGER, BADGE_POSITIVE, BADGE_WARNING } from "../../lib/ui";

const CLASS_BY_STATUS: Record<SubmissionStatus, string> = {
  completed: BADGE_POSITIVE,
  draft: BADGE_WARNING,
  spam: BADGE_DANGER,
};

const LABELS: Record<SubmissionStatus, string> = {
  completed: "Completed",
  draft: "Draft",
  spam: "Spam",
};

export function StatusPill({ status }: { status: SubmissionStatus }) {
  return (
    <span className={CLASS_BY_STATUS[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
