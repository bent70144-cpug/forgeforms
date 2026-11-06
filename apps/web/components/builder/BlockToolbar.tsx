'use client';

// Floating block toolbar on the selected card (builder spec §5.2): drag handle
// (wave-1 placeholder), move up/down, duplicate, delete (no confirm, §6.4) and
// a "⋯" details/summary menu with copy / duplicate / convert.
//
// `limited` renders the §5.4 variant for unknown kinds: Duplicate + Delete
// only (props are preserved; moving/convert is meaningless for unsupported
// kinds and could corrupt the document).
import type { Block } from "@formforge/schema";
import {
  clipboardEnvelope,
  convertTargetKind,
  type CanvasActions,
} from "@/lib/builder/canvas-ops";

const TOOLBAR_BTN =
  "flex h-11 w-11 items-center justify-center rounded-md text-base text-slate-600 " +
  "hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40";
const MENU_BTN =
  "block w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 " +
  "disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent";

/** Best-effort clipboard write (§6.4 copy/paste); cross-tab copy never throws. */
function copyText(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard permission denied / insecure context — ignore by spec.
  }
}

export type BlockToolbarProps = {
  block: Block;
  index: number;
  siblingCount: number;
  referencedByRules: boolean;
  actions: CanvasActions;
  /** §5.4 unknown-kind variant: only Duplicate + Delete. */
  limited?: boolean;
};

export function BlockToolbar({
  block,
  index,
  siblingCount,
  referencedByRules,
  actions,
  limited = false,
}: BlockToolbarProps) {
  const convertTarget = convertTargetKind(block.kind);
  const deleteTitle = referencedByRules
    ? "Delete (used by logic — rules will be flagged)"
    : "Delete";

  return (
    <div
      data-testid="block-toolbar"
      onClick={(event) => event.stopPropagation()}
      className="absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-0.5 shadow-lg backdrop-blur"
    >
      {/* Drag handle — rendered now, wired to dnd-kit in wave 3 (§6.2). */}
      <span
        aria-hidden="true"
        title="Drag to move (coming soon)"
        className="flex h-11 w-8 cursor-grab select-none items-center justify-center text-slate-400"
      >
        ⠿
      </span>

      {!limited ? (
        <>
          <button
            type="button"
            aria-label="Move up"
            title="Move up"
            disabled={index <= 0}
            onClick={() => actions.move(block.id, -1)}
            className={TOOLBAR_BTN}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move down"
            title="Move down"
            disabled={index >= siblingCount - 1}
            onClick={() => actions.move(block.id, 1)}
            className={TOOLBAR_BTN}
          >
            ↓
          </button>
        </>
      ) : null}

      <button
        type="button"
        aria-label="Duplicate question"
        title="Duplicate"
        onClick={() => actions.duplicate(block.id)}
        className={TOOLBAR_BTN}
      >
        ⧉
      </button>

      <button
        type="button"
        aria-label="Delete block"
        title={deleteTitle}
        onClick={() => actions.remove(block.id)}
        className={`${TOOLBAR_BTN} hover:text-red-600`}
      >
        ✕
      </button>

      {!limited ? (
        <details className="relative">
          <summary
            aria-label="More actions"
            title="More actions"
            className={`${TOOLBAR_BTN} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
          >
            ⋯
          </summary>
          <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-xl">
            <button
              type="button"
              className={MENU_BTN}
              onClick={() => copyText(clipboardEnvelope(block))}
            >
              Copy
            </button>
            <button type="button" className={MENU_BTN} onClick={() => actions.duplicate(block.id)}>
              Duplicate
            </button>
            {convertTarget ? (
              <button
                type="button"
                className={MENU_BTN}
                onClick={() => actions.convert(block.id, convertTarget)}
              >
                {convertTarget === "dropdown" ? "Convert to dropdown" : "Convert to single select"}
              </button>
            ) : (
              <button
                type="button"
                className={MENU_BTN}
                disabled
                title="Conversion is only available between single select and dropdown"
              >
                Convert
              </button>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}
