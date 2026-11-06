'use client';

// Empty-document state (builder spec §5.3): "Add your first question" with the
// three suggested blocks and a template link. Each suggestion dispatches a
// root block.insert at index 0 and selects the new block (done by the caller).
import { QUICK_ADD_KINDS } from "./InsertionRow";

export function EmptyCanvasState({ onAdd }: { onAdd: (kind: string) => void }) {
  return (
    <div
      data-testid="empty-canvas"
      className="mt-4 rounded-[var(--ff-radius)] border-2 border-dashed border-slate-300 bg-white/60 p-10 text-center"
    >
      <h2
        className="text-lg font-semibold text-slate-900"
        style={{ fontFamily: "var(--ff-font-heading)" }}
      >
        Add your first question
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Pick a suggestion below, or hover between blocks and press “+”.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {QUICK_ADD_KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            aria-label={`Add ${entry.label}`}
            onClick={() => onAdd(entry.kind)}
            className="min-h-[44px] rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
          >
            {entry.label}
          </button>
        ))}
      </div>
      <a
        href="/templates"
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-block text-sm font-medium text-slate-500 underline hover:text-slate-800"
      >
        Start from a template
      </a>
    </div>
  );
}
