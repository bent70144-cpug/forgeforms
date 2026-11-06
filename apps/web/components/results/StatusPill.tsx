import type { SubmissionStatus } from "../../lib/results";

const STYLES: Record<SubmissionStatus, string> = {
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  draft: "bg-amber-50 text-amber-700 ring-amber-600/20",
  spam: "bg-rose-50 text-rose-700 ring-rose-600/20",
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
