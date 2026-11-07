'use client';

// Builder canvas (builder spec §5): a scrollable, theme-live column of block
// cards — Start screen chrome → blocks with insertion points → ending cards.
//
// This is the only builder surface that subscribes to the whole store; every
// child receives stable props (see §13 memoization notes in BlockCard).
//
// WAVE-3 window-event contracts consumed here (emitters: useShortcuts /
// PublishControl / IssuesList — see lib/builder/canvas-ops.ts):
// - "ff:edit-selected" { id }  → opens that block's primary-text inline edit.
// - "ff:goto-block"    { id }  → scrolls the card into view + a brief
//   ff-int-flash highlight (animation guarded by prefers-reduced-motion).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { DocumentType, Theme } from "@formforge/schema";
import { DEFAULT_THEME_TOKENS, THEME_TOKEN_VARS } from "@/lib/bridge";
import type { CanvasActions } from "@/lib/builder/canvas-ops";
import {
  BUILDER_EVENTS,
  convertKindBlock,
  emitBlockDeleted,
  logicReferencedIds,
  moveByOffset,
  nextSelectionAfterRemove,
  quickInsertOp,
  type GotoBlockDetail,
  type EditSelectedDetail,
} from "@/lib/builder/canvas-ops";
import { blockDisplayLabel } from "@/lib/builder/blockMeta";
import { announce } from "@/lib/builder/announce";
import { duplicateBlockOp, findBlock, setDeep } from "@/lib/builder/ops";
import { BlockCard } from "./BlockCard";
import { EmptyCanvasState } from "./EmptyCanvasState";
import { useBuilder } from "./context";
import { InsertionRow } from "./InsertionRow";
import { useDragReorder } from "./useDragReorder";

/** Theme radius token → CSS length (§14.3 preview parity). */
const RADIUS_TOKEN_PX: Record<Theme["radius"], string> = {
  none: "0px",
  sm: "4px",
  md: "8px",
  lg: "16px",
  full: "9999px",
};

/** Live theme (§5.1): map body.theme onto the --ff-* CSS variables. */
function canvasThemeVars(theme: Theme): CSSProperties {
  const vars: Record<string, string> = {
    "--ff-font-heading": `'${theme.fontHeading}', ui-sans-serif, system-ui, sans-serif`,
    "--ff-font-body": `'${theme.fontBody}', ui-sans-serif, system-ui, sans-serif`,
    "--ff-radius": RADIUS_TOKEN_PX[theme.radius] ?? "8px",
  };
  for (const token of Object.keys(THEME_TOKEN_VARS) as Array<keyof typeof THEME_TOKEN_VARS>) {
    vars[THEME_TOKEN_VARS[token]] = theme.tokens[token] ?? DEFAULT_THEME_TOKENS[token] ?? "transparent";
  }
  return vars as CSSProperties;
}

/** How long the §6.4 goto-block flash stays on the target card. */
const FLASH_MS = 1200;

/** Attribute-selector-safe id (ids are nanoid alphabet, but stay defensive). */
function blockSelector(id: string): string {
  const safe = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
  return `[data-block-id="${safe}"]`;
}

function deselectAtRoot(event: MouseEvent<HTMLElement>, select: (id: string | null) => void): void {
  // Clicking empty canvas selects the document (§5.2) — only for direct hits
  // on the scroll/column surfaces, never for bubbled card clicks.
  if (event.target === event.currentTarget) select(null);
}

/** Non-block chrome card for the welcome step (§5.1). */
function StartScreenCard({ type, onOpen }: { type: DocumentType; onOpen: () => void }) {
  const title = type === "form" ? "Start screen" : "Start";
  const subtitle =
    type === "form" ? "Respondents see this first" : "Visitors land on this first";
  return (
    <article
      role="group"
      aria-label="Start screen (document settings)"
      data-testid="start-screen-card"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="mb-2 cursor-pointer rounded-[var(--ff-radius)] border border-[color:var(--ff-border)] bg-white p-6 text-center shadow-sm outline-1 outline-offset-2 outline-transparent hover:[outline-color:var(--ff-border)] focus-visible:[outline:2px_solid_var(--ff-primary)]"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Welcome</p>
      <h2
        className="mt-1 text-xl font-semibold text-slate-900"
        style={{ fontFamily: "var(--ff-font-heading)" }}
      >
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </article>
  );
}

export type CanvasProps = {
  /** Test seam (wave 3): start with a block's inline edit already requested. */
  initialEditingBlockId?: string | null;
};

export function Canvas({ initialEditingBlockId = null }: CanvasProps) {
  const { state, dispatch } = useBuilder();
  const { body, selection } = state;

  // Latest-state ref keeps the action callbacks stable across renders, which
  // is what makes per-card React.memo effective (spec §13).
  const stateRef = useRef(state);
  stateRef.current = state;

  // §6.5 "ff:edit-selected": the id whose primary text should be editing.
  // Cleared from the cards via onEditSettled on commit/cancel.
  const [editingBlockId, setEditingBlockId] = useState<string | null>(initialEditingBlockId);

  const rootRef = useRef<HTMLElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  // --- "ff:goto-block": scroll into view + brief flash highlight (§6.4) ----
  useEffect(() => {
    function onGotoBlock(event: Event) {
      const id = (event as CustomEvent<GotoBlockDetail>).detail?.id;
      if (typeof id !== "string") return;
      const root = rootRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(blockSelector(id));
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("ff-int-flash");
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = null;
        el.classList.remove("ff-int-flash");
      }, FLASH_MS);
    }
    window.addEventListener(BUILDER_EVENTS.gotoBlock, onGotoBlock);
    return () => {
      window.removeEventListener(BUILDER_EVENTS.gotoBlock, onGotoBlock);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  // --- "ff:edit-selected": open the requested block's inline edit ----------
  useEffect(() => {
    function onEditSelected(event: Event) {
      const id = (event as CustomEvent<EditSelectedDetail>).detail?.id;
      if (typeof id !== "string") return;
      setEditingBlockId(id);
    }
    window.addEventListener(BUILDER_EVENTS.editSelected, onEditSelected);
    return () => window.removeEventListener(BUILDER_EVENTS.editSelected, onEditSelected);
  }, []);

  const clearEditing = useCallback(() => setEditingBlockId(null), []);

  const select = useCallback(
    (id: string | null) => dispatch({ type: "select", id }),
    [dispatch],
  );

  const insert = useCallback(
    (kind: string, index: number, parentId: string | null) => {
      const { op, block } = quickInsertOp(kind, index, parentId);
      dispatch({ type: "apply", ops: [op], label: `Add ${blockDisplayLabel(block)}` });
      dispatch({ type: "select", id: block.id });
    },
    [dispatch],
  );

  const move = useCallback(
    (id: string, delta: number, opts?: { label?: string }) => {
      const current = stateRef.current.body.blocks;
      const op = moveByOffset(current, id, delta);
      if (!op) return;
      // §3.3: all block.move dispatches share the move:<id> coalescing key
      // (keyboard repeat; a drag drop right after a keyboard move), so one
      // history entry + ONE outgoing op per gesture run.
      dispatch({
        type: "apply",
        ops: [op],
        label: opts?.label ?? (delta < 0 ? "Move up" : "Move down"),
        coalesce: { key: `move:${id}`, at: Date.now() },
      });
      // §12/§6.2 live announcement — same message for the toolbar arrows,
      // the Alt+↑/↓ keyboard path (see useShortcuts) and the drag drop
      // ("<label> moved to position N of M").
      const found = findBlock(current, id);
      if (found) {
        announce(
          `${blockDisplayLabel(found.block)} moved to position ${found.index + delta + 1} of ${found.list.length}`,
        );
      }
    },
    [dispatch],
  );

  const duplicate = useCallback(
    (id: string) => {
      const current = stateRef.current;
      const { op, clone } = duplicateBlockOp({ meta: current.meta, body: current.body }, id);
      dispatch({ type: "apply", ops: [op], label: "Duplicate block" });
      dispatch({ type: "select", id: clone.id });
    },
    [dispatch],
  );

  const remove = useCallback(
    (id: string) => {
      const current = stateRef.current;
      const found = findBlock(current.body.blocks, id);
      if (!found) return;
      const label = blockDisplayLabel(found.block);
      const hadLogic = logicReferencedIds(current.body.logic.rules).has(id);
      dispatch({ type: "apply", ops: [{ op: "block.remove", id }], label: "Delete block" });
      dispatch({ type: "select", id: nextSelectionAfterRemove(current.body.blocks, id) });
      // UndoToast contract: offers an 8 s undo; §6.4 adds the
      // "used by logic" warning when hadLogic is true.
      emitBlockDeleted({ id, label, hadLogic });
    },
    [dispatch],
  );

  const convert = useCallback(
    (id: string, toKind: string) => {
      const current = stateRef.current;
      const found = findBlock(current.body.blocks, id);
      if (!found) return;
      const converted = convertKindBlock(found.block, toKind);
      if (!converted) return;
      const parent =
        found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
      // No kind-update op exists, so conversion = remove + re-insert at the
      // same position with the same id (props mapped by canvas-ops).
      dispatch({
        type: "apply",
        ops: [
          { op: "block.remove", id },
          { op: "block.insert", parentId: parent?.id ?? null, index: found.index, block: converted },
        ],
        label: `Convert to ${toKind}`,
      });
      dispatch({ type: "select", id });
    },
    [dispatch],
  );

  const updatePrimaryText = useCallback(
    (blockId: string, primaryProp: string, value: string) => {
      dispatch({
        type: "apply",
        ops: [{ op: "block.update", id: blockId, props: setDeep(primaryProp, value) }],
        label: "Edit text",
        // §3.3/§6.6: rapid commits to the same block merge into one history
        // entry + one outgoing op (convention from store.ts: update:<blockId>).
        coalesce: { key: `update:${blockId}`, at: Date.now() },
      });
    },
    [dispatch],
  );

  const openEndings = useCallback(
    () => dispatch({ type: "setPanel", panel: "endings" }),
    [dispatch],
  );

  const actions = useMemo<CanvasActions>(
    () => ({ select, insert, move, duplicate, remove, convert, updatePrimaryText, openEndings }),
    [select, insert, move, duplicate, remove, convert, updatePrimaryText, openEndings],
  );

  const referencedIds = useMemo(() => logicReferencedIds(body.logic.rules), [body.logic.rules]);
  const themeStyle = useMemo(() => canvasThemeVars(body.theme), [body.theme]);

  // §6.2 follow-up #7: delegated pointer/touch drag reordering — the toolbar
  // ⠿ handle starts the gesture; on drop exactly ONE block.move op goes
  // through actions.move (coalescing + undo grouping + announce all reused).
  const { drag } = useDragReorder({ rootRef, actions });

  const blocks = body.blocks;
  const isEmpty = blocks.length === 0;

  return (
    <section
      ref={rootRef}
      role="region"
      aria-label="Form editor"
      data-testid="builder-canvas"
      onClick={(event) => deselectAtRoot(event, select)}
      className="ff-canvas min-h-full w-full overflow-x-hidden overflow-y-auto bg-[color:var(--ff-bg)] transition-colors"
      style={{ ...themeStyle, fontFamily: "var(--ff-font-body)", color: "var(--ff-fg)" }}
    >
      <div
        className="relative mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6"
        onClick={(event) => deselectAtRoot(event, select)}
      >
        {/* §6.2 drop indicator — absolutely positioned inside the content
            column (no layout shift); pointer-events-none, aria-hidden. */}
        {drag ? (
          <div
            aria-hidden="true"
            data-testid="drop-indicator"
            data-drop-slot={drag.dropSlot}
            className="pointer-events-none absolute inset-x-4 z-20 h-0.5 rounded-full bg-[color:var(--ff-primary)]"
            style={{ top: drag.indicatorTop }}
          />
        ) : null}
        <StartScreenCard type={body.type} onOpen={() => select(null)} />

        {isEmpty ? (
          <EmptyCanvasState onAdd={(kind) => insert(kind, 0, null)} />
        ) : (
          <>
            <InsertionRow index={0} parentId={null} actions={actions} />
            {blocks.map((block, index) => (
              <Fragment key={block.id}>
                <BlockCard
                  block={block}
                  depth={0}
                  index={index}
                  parentId={null}
                  siblingCount={blocks.length}
                  selected={block.id === selection}
                  selectedId={selection}
                  referencedIds={referencedIds}
                  actions={actions}
                  editingId={editingBlockId}
                  onEditSettled={clearEditing}
                />
                <InsertionRow index={index + 1} parentId={null} actions={actions} />
              </Fragment>
            ))}
          </>
        )}

        {body.endings.map((ending) => (
          <button
            key={ending.id}
            type="button"
            data-testid="ending-card"
            aria-label={`Ending: ${ending.title}`}
            title="Open endings settings"
            onClick={(event) => {
              event.stopPropagation();
              openEndings();
            }}
            className="mt-2 flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[var(--ff-radius)] border border-[color:var(--ff-border)] bg-white p-4 text-left shadow-sm hover:shadow-md"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-800" dir="auto">
                {ending.title}
              </span>
              <span className="text-xs text-slate-500">Final screen shown after submission</span>
            </span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              Ending
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
