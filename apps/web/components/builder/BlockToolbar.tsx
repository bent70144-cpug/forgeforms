'use client';

// Floating block toolbar on the selected card (builder spec §5.2): drag
// handle (pointer drag via useDragReorder — §6.2 follow-up #7), move up/down,
// duplicate, delete (no confirm, §6.4) and a "⋯" details/summary menu with
// copy / duplicate / convert.
//
// `limited` renders the §5.4 variant for unknown kinds: Duplicate + Delete
// only (props are preserved; moving/convert is meaningless for unsupported
// kinds and could corrupt the document).
// Meridian chrome (2026 restyle): a white pill toolbar — 1px hairline border,
// --ff-shadow-md, ghost icon buttons with the same tooltips, danger-tinted
// delete. Buttons keep their 44px touch targets; the only transitions are
// transform/opacity (design-system rule).
import type { Block } from "@formforge/schema";
import {
  clipboardEnvelope,
  convertTargetKind,
  type CanvasActions,
} from "@/lib/builder/canvas-ops";

const TOOLBAR_BTN =
  "flex h-11 w-11 items-center justify-center rounded-full text-base text-[color:var(--ff-muted)] " +
  "transition-colors duration-150 hover:bg-[color:var(--ff-bg-2)] hover:text-[color:var(--ff-fg)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--ff-accent)] " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
const MENU_BTN =
  "block w-full px-3 py-2 text-left text-sm font-medium text-[color:var(--ff-fg)] " +
  "transition-colors duration-150 hover:bg-[color:var(--ff-bg-2)] " +
  "disabled:cursor-not-allowed disabled:text-[color:var(--ff-muted)] disabled:hover:bg-transparent";

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
  /** Container block id, or null for the root list (§6.2 drag targeting). */
  parentId?: string | null;
  siblingCount: number;
  referencedByRules: boolean;
  actions: CanvasActions;
  /** §5.4 unknown-kind variant: only Duplicate + Delete. */
  limited?: boolean;
};

export function BlockToolbar({
  block,
  index,
  parentId = null,
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
      className="absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-full border border-[color:var(--ff-border)] bg-[color:var(--ff-card)] p-1 text-[color:var(--ff-fg)] shadow-[var(--ff-shadow-md)]"
    >
      {/* Drag handle (§6.2 follow-up #7): real pointer/touch drag via the
          delegated listeners in useDragReorder (Canvas) — activation after
          ~8 px keeps taps/clicks/inline edits working; touch-action:none
          keeps touch scroll from hijacking the gesture. Pointer-only and
          aria-hidden: keyboard users reorder with Alt+↑/↓ (useShortcuts) or
          the labelled Move buttons (§18: mobile keeps move buttons). The
          limited §5.4 variant stays an inert glyph — unknown kinds must not
          move. */}
      <span
        aria-hidden="true"
        title="Drag to move"
        data-testid="drag-handle"
        {...(limited
          ? {}
          : {
              "data-drag-handle": block.id,
              "data-drag-parent": parentId ?? "",
              "data-drag-index": index,
            })}
        className="flex h-11 w-8 cursor-grab touch-none select-none items-center justify-center text-[color:var(--ff-muted)] transition-[opacity] duration-150 active:cursor-grabbing active:text-[color:var(--ff-primary)]"
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
        className={`${TOOLBAR_BTN} hover:bg-[color:color-mix(in_srgb,var(--ff-danger)_12%,transparent)] hover:text-[color:var(--ff-danger)]`}
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
          <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-[color:var(--ff-border)] bg-[color:var(--ff-card)] py-1 text-[color:var(--ff-fg)] shadow-[var(--ff-shadow-lg)]">
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
