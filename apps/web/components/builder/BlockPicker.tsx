'use client';

// Block picker — command-palette modal (builder spec §6.1, a11y §12).
//
// Opens from the canvas "+", the left-pane Add tab, `/` or Cmd/Ctrl+K
// (emitters: canvas + useShortcuts via the "ff:open-picker" window event —
// see useBlockPicker.ts for the event contract). Shows the palette for the
// current document type (contextual family ordering via paletteForType),
// fuzzy-filters on label + kind + hint, and inserts `block.insert` ops at the
// requested {parentId, index} with label "Add <label>", then selects the new
// block. Focus is trapped while open and restored to the previously focused
// element on close (spec §12).

// Aurora glass palette (2026 restyle): frosted modal, tokenized search field,
// categorized option grid with gradient icon tiles, violet active ring and a
// transform-only hover lift. A11y contract (listbox/option, activedescendant,
// focus trap) is unchanged from spec §12.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useBuilder } from "./context";
import {
  BLOCK_CATALOG,
  blockIcon,
  createBlock,
  getBlockMeta,
  paletteForType,
  type BlockFamily,
  type BlockMeta,
} from "@/lib/builder/blockMeta";

export type PaletteGroup = { family: BlockFamily; label: string; kinds: BlockMeta[] };

export type BlockPickerProps = {
  open: boolean;
  onClose: () => void;
  /** Where block.insert places the new block (null parentId = root). */
  insertAt: { index: number; parentId: string | null };
  /** Called after a successful insert with the inserted kind (wired in wave 3:
   *  BuilderPage focuses the new card's [data-block-id] element in a rAF). */
  onInsert?: (kind: string) => void;
};

// ---------------------------------------------------------------------------
// Fuzzy matching (pure, exported for tests)
// ---------------------------------------------------------------------------

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Score `query` against `text`: exact prefix > substring > in-order
 * subsequence > miss. Higher is better; -1 means "no match". An empty query
 * matches everything with a neutral 0 (picker shows the full palette).
 */
export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at === 0) return 3000;
  if (at > 0) return 2000 - Math.min(at, 500);
  let from = 0;
  let streak = 0;
  let streakBonus = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found === -1) return -1;
    if (found === from) {
      streak += 1;
      streakBonus += 10 * streak;
    } else {
      streak = 0;
    }
    from = found + 1;
  }
  return 1000 + Math.min(streakBonus, 999);
}

function bestScore(query: string, meta: BlockMeta): number {
  return Math.max(
    fuzzyScore(query, meta.label),
    fuzzyScore(query, meta.kind),
    meta.hint ? fuzzyScore(query, meta.hint) : -1,
  );
}

/** Filter + rank palette groups (catalog order preserved for ties). */
export function filterPalette(groups: PaletteGroup[], query: string): PaletteGroup[] {
  const q = normalize(query);
  if (!q) return groups;
  return groups
    .map((group) => ({
      ...group,
      kinds: group.kinds
        .map((meta) => ({ meta, score: bestScore(q, meta) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.meta),
    }))
    .filter((group) => group.kinds.length > 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BlockPicker({ open, onClose, insertAt, onInsert }: BlockPickerProps) {
  const { state, dispatch } = useBuilder();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listId = useId();

  const groups = useMemo(() => filterPalette(paletteForType(state.body.type), query), [state.body.type, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.kinds), [groups]);
  const indexByKind = useMemo(() => new Map(flat.map((meta, i) => [meta.kind, i])), [flat]);
  const total = flat.length;
  const activeMeta = flat[activeIndex] ?? null;
  const activeId = `${listId}-opt-${activeIndex}`;

  // On open: reset state, capture focus to restore later, focus the search box.
  // On close: restore focus (spec §12 focus trap/return).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    previousFocusRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [open]);

  // Keep the highlighted option visible while navigating.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, open]);

  const insertKind = useCallback(
    (meta: BlockMeta) => {
      const block = createBlock(meta.kind);
      dispatch({
        type: "apply",
        ops: [{ op: "block.insert", parentId: insertAt.parentId, index: insertAt.index, block }],
        label: `Add ${meta.label}`,
      });
      // createBlock returned the block, so its fresh id is known without reading state.
      dispatch({ type: "select", id: block.id });
      onInsert?.(meta.kind);
      onClose();
    },
    [dispatch, insertAt.index, insertAt.parentId, onClose, onInsert],
  );

  const trapFocus = useCallback((event: ReactKeyboardEvent) => {
    const root = dialogRef.current;
    if (!root || typeof document === "undefined") return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    const current = document.activeElement;
    const outside = !(current instanceof Node) || !root.contains(current);
    if (event.shiftKey) {
      if (current === first || outside) {
        event.preventDefault();
        last.focus();
      }
    } else if (current === last || outside) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose();
          return;
        case "Backspace":
          if (query === "") {
            event.preventDefault();
            onClose();
          }
          return;
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((i) => (total === 0 ? 0 : (i + 1) % total));
          return;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((i) => (total === 0 ? 0 : (i - 1 + total) % total));
          return;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          return;
        case "End":
          event.preventDefault();
          setActiveIndex(Math.max(0, total - 1));
          return;
        case "Enter": {
          event.preventDefault();
          if (activeMeta) insertKind(activeMeta);
          return;
        }
        case "Tab":
          trapFocus(event);
          return;
        default:
          return;
      }
    },
    [activeMeta, insertKind, onClose, query, total, trapFocus],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a block"
        className="relative mx-auto mt-[10vh] flex w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-[color:var(--ff-glass-border)] bg-[color:var(--ff-glass)] text-[color:var(--ff-fg)] shadow-[var(--ff-glow-soft),var(--ff-shadow-lg)] backdrop-blur-xl"
      >
        {/* Search — the §6.1 command-palette anchor (tokenized input). */}
        <div className="border-b border-[color:var(--ff-glass-border)] p-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search blocks…"
            aria-label="Search blocks"
            aria-controls={listId}
            aria-activedescendant={total > 0 ? activeId : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            className="ff-input"
          />
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {total} {total === 1 ? "block" : "blocks"} match
        </p>

        <div
          id={listId}
          role="listbox"
          aria-label="Blocks"
          className="ff-picker-list max-h-80 overflow-y-auto overscroll-contain p-2"
        >
          {total === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[color:var(--ff-muted)]">
              No blocks match “{query}”
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.family} role="presentation" className="mb-1 last:mb-0">
                <div
                  className="sticky top-0 z-10 rounded-md px-2 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ff-muted)]"
                  style={{ background: "color-mix(in srgb, var(--ff-card) 92%, transparent)" }}
                  aria-hidden="true"
                >
                  {group.label}
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {group.kinds.map((meta) => {
                    const i = indexByKind.get(meta.kind) ?? 0;
                    const active = i === activeIndex;
                    return (
                      <div
                        key={meta.kind}
                        id={`${listId}-opt-${i}`}
                        role="option"
                        aria-selected={active}
                        aria-label={`${meta.label}${meta.hint ? ` — ${meta.hint}` : ""}`}
                        onClick={() => insertKind(meta)}
                        onMouseMove={() => setActiveIndex(i)}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2 text-sm transition-[transform,opacity] duration-150 ease-[var(--ff-ease-out)] hover:-translate-y-px ${
                          active
                            ? "border-[color:var(--ff-primary)] bg-[color:color-mix(in_srgb,var(--ff-primary)_14%,transparent)]"
                            : "border-transparent hover:border-[color:var(--ff-border)] hover:bg-[color:color-mix(in_srgb,var(--ff-fg)_5%,transparent)]"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          style={{ background: "var(--ff-grad)" }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-sm shadow-[var(--ff-glow)]"
                        >
                          {blockIcon(meta.kind) || meta.icon}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{meta.label}</span>
                          {meta.hint ? (
                            <span className="truncate text-xs text-[color:var(--ff-muted)]">{meta.hint}</span>
                          ) : null}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide text-[color:var(--ff-muted)]">
                          {meta.kind}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[color:var(--ff-glass-border)] px-4 py-2 text-[11px] text-[color:var(--ff-muted)]">
          ↑↓ navigate · Enter insert · Esc close
        </div>
      </div>
    </div>
  );
}

/** Test seam — the catalog kinds available to the picker (kept stable). */
export const PICKER_CATALOG = BLOCK_CATALOG;

/** Re-export for wave-3 consumers so they don't import blockMeta directly. */
export { getBlockMeta };
