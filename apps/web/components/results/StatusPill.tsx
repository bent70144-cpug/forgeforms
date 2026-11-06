// T15 — semantic status pill, rebuilt on the design-system tokens (B5): the
// completed/draft/spam hues come from --ff-success/--ff-warning/--ff-danger and
// flip with the dark palette automatically — no raw Tailwind colors, no
// dark: variants. Leading 6px dot carries the same hue.

import type { CSSProperties } from "react";
import type { SubmissionStatus } from "../../lib/results";

const STYLES: Record<SubmissionStatus, CSSProperties> = {
  completed: {
    color: "var(--ff-success)",
    backgroundColor: "color-mix(in srgb, var(--ff-success) 10%, var(--ff-card))",
    borderColor: "color-mix(in srgb, var(--ff-success) 25%, transparent)",
  },
  draft: {
    color: "var(--ff-warning)",
    backgroundColor: "color-mix(in srgb, var(--ff-warning) 10%, var(--ff-card))",
    borderColor: "color-mix(in srgb, var(--ff-warning) 25%, transparent)",
  },
  spam: {
    color: "var(--ff-danger)",
    backgroundColor: "color-mix(in srgb, var(--ff-danger) 10%, var(--ff-card))",
    borderColor: "color-mix(in srgb, var(--ff-danger) 25%, transparent)",
  },
};

const LABELS: Record<SubmissionStatus, string> = {
  completed: "Completed",
  draft: "Draft",
  spam: "Spam",
};

export function StatusPill({ status }: { status: SubmissionStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={STYLES[status]}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
