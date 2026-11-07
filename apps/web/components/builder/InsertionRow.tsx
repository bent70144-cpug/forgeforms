'use client';

// Insertion point between blocks (builder spec §5.3): a thin accent line with
// a centered "+" that appears on row hover / keyboard focus. Clicking emits
// the "ff:open-picker" contract; the BlockPicker (useBlockPicker) opens
// anchored at {parentId, index} and inserts through the normal store path.
// (Wave-1's inline quick-menu fallback was removed in wave 3 — the picker
// supersedes it and the two stacked modals fought over focus/Escape.)
import type { CanvasActions } from "@/lib/builder/canvas-ops";
import { emitOpenPicker } from "@/lib/builder/canvas-ops";

/** §5.3 empty-state suggestions (single-select = "multiple choice"). */
export const QUICK_ADD_KINDS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: "short-text", label: "Short text" },
  { kind: "email", label: "Email" },
  { kind: "single-select", label: "Multiple choice" },
];

export type InsertionRowProps = {
  /** Insert position in the target list (0 = before everything). */
  index: number;
  /** Container block id, or null for the root list. */
  parentId: string | null;
  actions: CanvasActions;
};

export function InsertionRow({ index, parentId, actions }: InsertionRowProps) {
  void actions; // kept in the prop contract for future direct-insert affordances
  return (
    <div
      className="group relative flex h-7 items-center justify-center"
      data-testid="insertion-row"
      data-insert-index={index}
      data-insert-parent={parentId ?? "root"}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color:var(--ff-primary)] opacity-0 transition-opacity group-hover:opacity-50 group-focus-within:opacity-50"
      />
      <button
        type="button"
        aria-label="Insert block here"
        title="Insert block here"
        onClick={() => emitOpenPicker({ index, parentId })}
        className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--ff-border)] bg-white text-sm font-medium leading-none text-[color:var(--ff-primary)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-slate-50"
      >
        +
      </button>
    </div>
  );
}
