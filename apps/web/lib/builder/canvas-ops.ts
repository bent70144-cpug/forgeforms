// Canvas-editing helpers (builder spec §5, §6.4) — pure logic, no React/DOM,
// so the canvas chrome (BlockCard/BlockToolbar/InsertionRow) stays thin and
// the move/insert/convert math is unit-testable.
//
// Window-event contracts consumed by wave 3 (BlockPicker / UndoToast):
// - "ff:open-picker"  detail: OpenPickerDetail  { index, parentId }
// - "ff:block-deleted" detail: BlockDeletedDetail { id, label, hadLogic }

import type { Block, Rule } from "@formforge/schema";
import { createBlock } from "./blockMeta";
import { newId } from "./id";
import { findBlock, type Op } from "./ops";

// ---------------------------------------------------------------------------
// Shared action surface (implemented once in Canvas, passed down as props so
// BlockCard stays React.memo-able — spec §13 per-block memoization)
// ---------------------------------------------------------------------------

export type CanvasActions = {
  readonly select: (id: string | null) => void;
  readonly insert: (kind: string, index: number, parentId: string | null) => void;
  readonly move: (id: string, delta: number) => void;
  readonly duplicate: (id: string) => void;
  readonly remove: (id: string) => void;
  readonly convert: (id: string, toKind: string) => void;
  readonly updatePrimaryText: (blockId: string, primaryProp: string, value: string) => void;
  readonly openEndings: () => void;
};

// ---------------------------------------------------------------------------
// Move (§5.2 toolbar arrows; drag lands in wave 3 and reuses block.move)
// ---------------------------------------------------------------------------

/**
 * Op to move `id` by `delta` positions within its own list (root list or the
 * children of its parent — never across parents in this milestone). Returns
 * null when the move is a no-op (at either boundary, delta 0, unknown id).
 *
 * `block.move` index semantics (ops.ts) are "final position in the destination
 * list *after* removal", which for a same-list ±1 move is exactly index+delta.
 */
export function moveByOffset(blocks: Block[], id: string, delta: number): Op | null {
  if (delta === 0) return null;
  const found = findBlock(blocks, id);
  if (!found) return null;
  const clamped = Math.max(0, Math.min(found.index + delta, found.list.length - 1));
  if (clamped === found.index) return null;
  const parent = found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
  return { op: "block.move", id, parentId: parent?.id ?? null, index: clamped };
}

// ---------------------------------------------------------------------------
// Insert (§5.3 insertion rows + empty-state suggestions)
// ---------------------------------------------------------------------------

/** Build a default block of `kind` and the insert op placing it at `index`. */
export function quickInsertOp(
  kind: string,
  index: number,
  parentId: string | null = null,
  makeId: () => string = newId,
): { op: Op; block: Block } {
  const block = createBlock(kind, makeId);
  return { op: { op: "block.insert", parentId, index, block }, block };
}

// ---------------------------------------------------------------------------
// Delete (§6.4: no confirm; select the next block, else the previous)
// ---------------------------------------------------------------------------

/** Best next selection after removing `id`: following sibling, else preceding. */
export function nextSelectionAfterRemove(blocks: Block[], id: string): string | null {
  const found = findBlock(blocks, id);
  if (!found) return null;
  const next = found.list[found.index + 1] ?? found.list[found.index - 1] ?? null;
  return next?.id ?? null;
}

// ---------------------------------------------------------------------------
// Convert (§5.2 "convert type where compatible": single-select ⇄ dropdown)
// ---------------------------------------------------------------------------

/** Props shared by both select kinds; kind-specific flags are dropped so the
 * result always parses against the target's (strict) propsSchema. */
const CONVERT_KEEP_PROPS: ReadonlySet<string> = new Set([
  "label",
  "options",
  "description",
  "required",
  "buttonText",
  "imageAssetId",
  "prefillParam",
]);

/** The kind a block can be converted to, or null when not convertible. */
export function convertTargetKind(kind: string): string | null {
  if (kind === "single-select") return "dropdown";
  if (kind === "dropdown") return "single-select";
  return null;
}

/**
 * Map a block to `toKind`, keeping only the shared option/question props.
 * Returns null when the conversion is not supported (wrong target or a source
 * kind outside the single-select ⇄ dropdown pair). The block id is preserved.
 */
export function convertKindBlock(block: Block, toKind: string): Block | null {
  if (convertTargetKind(block.kind) !== toKind) return null;
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block.props)) {
    if (CONVERT_KEEP_PROPS.has(key)) props[key] = value;
  }
  return { ...block, kind: toKind, props };
}

// ---------------------------------------------------------------------------
// Logic references (§6.4: warn "Used by N logic rules" in the undo toast)
// ---------------------------------------------------------------------------

/** True when any rule reads the block (scope/condition) or jumps to it. */
export function hasLogicReference(rules: readonly Rule[], blockId: string): boolean {
  const ref = `@block:${blockId}`;
  return rules.some(
    (rule) =>
      rule.scope === blockId ||
      rule.when.some((condition) => condition.left === ref) ||
      rule.then.some((action) => action.type === "goto" && action.target === blockId),
  );
}

/** Set of block ids referenced by any rule (for card badges / toolbar hints). */
export function logicReferencedIds(rules: readonly Rule[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const consider = (blockId: string): void => {
    if (hasLogicReference(rules, blockId)) ids.add(blockId);
  };
  for (const rule of rules) {
    if (rule.scope !== "start") consider(rule.scope);
    for (const condition of rule.when) {
      if (condition.left.startsWith("@block:")) consider(condition.left.slice("@block:".length));
    }
    for (const action of rule.then) {
      if (action.type === "goto" && !action.target.startsWith("end:")) consider(action.target);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Clipboard envelope (§6.4: versioned cross-tab paste envelope)
// ---------------------------------------------------------------------------

export function clipboardEnvelope(block: Block): string {
  return JSON.stringify({ formforge: 1, blocks: [block] });
}

// ---------------------------------------------------------------------------
// Window-event contracts (emitted here, SSR-safe; consumers: useBlockPicker
// for the picker event, UndoToast for deletes, Canvas for goto/edit — all
// wired since the wave-3 integration).
// ---------------------------------------------------------------------------

export type OpenPickerDetail = { index: number; parentId: string | null };
export type BlockDeletedDetail = { id: string; label: string; hadLogic: boolean };
/** ff:edit-selected detail (emitter: useShortcuts Enter; consumer: Canvas). */
export type EditSelectedDetail = { id: string };
/** ff:goto-block detail (emitter: IssuesList/PublishControl; consumer: Canvas). */
export type GotoBlockDetail = { id: string };
/**
 * ff:plan-limit detail (§14, follow-up #8): the publish path was refused with
 * 402/403 — the builder page listens and surfaces the inline shell notice.
 */
export type PlanLimitDetail = { status: 402 | 403; message: string; capability: string | null };

/** Event names — keep in sync with useShortcuts / PublishControl / UndoToast. */
export const BUILDER_EVENTS = {
  openPicker: "ff:open-picker",
  blockDeleted: "ff:block-deleted",
  editSelected: "ff:edit-selected",
  gotoBlock: "ff:goto-block",
  planLimit: "ff:plan-limit",
} as const;

export function emitPlanLimit(detail: PlanLimitDetail): void {
  if (typeof window === "undefined") return; // SSR/static-render safety
  window.dispatchEvent(new CustomEvent<PlanLimitDetail>("ff:plan-limit", { detail }));
}

export function emitOpenPicker(detail: OpenPickerDetail): void {
  if (typeof window === "undefined") return; // SSR/static-render safety
  window.dispatchEvent(new CustomEvent<OpenPickerDetail>("ff:open-picker", { detail }));
}

export function emitBlockDeleted(detail: BlockDeletedDetail): void {
  if (typeof window === "undefined") return; // SSR/static-render safety
  window.dispatchEvent(new CustomEvent<BlockDeletedDetail>("ff:block-deleted", { detail }));
}
