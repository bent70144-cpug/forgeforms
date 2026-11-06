import type { SubmissionStatus } from "../../lib/results";

// Semantic status hues with explicit dark variants so the pills stay readable
// when the app flips to its dark token palette.
const STYLES: Record<SubmissionStatus, string> = {
  completed:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  draft: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  spam: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/30",
};

const LABELS: Record<SubmissionStatus, string> = {
  completed: "Completed",
  draft: "Draft",
  spam: "Spam",
};

export function StatusPill({ status }: { status: SubmissionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
