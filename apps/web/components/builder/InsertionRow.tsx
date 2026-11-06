'use client';

// Insertion point between blocks (builder spec §5.3): a thin accent line with
// a centered "+" that appears on row hover / keyboard focus. Clicking emits
// the wave-3 picker contract ("ff:open-picker") AND opens a small quick-menu
// with three suggested blocks so insertion works before the picker lands.
import { useState } from "react";
import type { CanvasActions } from "@/lib/builder/canvas-ops";
import { emitOpenPicker } from "@/lib/builder/canvas-ops";

/** §5.3 empty-state + quick-menu suggestions (single-select = "multiple choice"). */
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
  const [menuOpen, setMenuOpen] = useState(false);

  const openHere = (): void => {
    // Wave-3 contract: BlockPicker listens for "ff:open-picker" and opens
    // anchored at (parentId, index); detail shape in canvas-ops.ts.
    emitOpenPicker({ index, parentId });
    setMenuOpen(true); // graceful fallback until the picker lands (wave 3)
  };

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
        onClick={openHere}
        className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--ff-border)] bg-white text-sm font-medium leading-none text-[color:var(--ff-primary)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-slate-50"
      >
        +
      </button>

      {menuOpen ? (
        <div
          role="menu"
          aria-label="Quick add block"
          className="absolute left-1/2 top-full z-30 flex -translate-x-1/2 items-center gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-xl"
        >
          {QUICK_ADD_KINDS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                actions.insert(entry.kind, index, parentId);
                setMenuOpen(false);
              }}
              className="whitespace-nowrap rounded px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Close quick menu"
            title="Close"
            onClick={() => setMenuOpen(false)}
            className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
