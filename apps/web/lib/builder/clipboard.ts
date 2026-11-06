// Builder clipboard (builder spec §6.4 "Copy/paste").
//
// Envelope: `{ formforge: 1, blocks: Block[] }` — versioned so a future shape
// change is rejected instead of pasting garbage. Copy mirrors the JSON to
// `text/plain` (system clipboard) for CROSS-TAB paste and always keeps a
// module-level internal clipboard for the same-tab flow (and for environments
// without clipboard permissions, including tests).
//
// Pasting validates the envelope, then re-ids every block AND every option id
// nested in `props.options` (`{ id, label }` lists shared by single-select,
// multi-select and dropdown — packages/blocks/src/shared/option-list.ts).
// Pure data + functions, no React — fully unit-testable (node env).

import type { Block } from "../bridge";
import { cloneWithNewIds, type Op } from "./ops";
import { newId } from "./id";

/** The `block.insert` member of the Op union (paste always emits inserts). */
export type BlockInsertOp = Extract<Op, { op: "block.insert" }>;

export const CLIPBOARD_VERSION = 1;

export type ClipboardEnvelope = {
  formforge: typeof CLIPBOARD_VERSION;
  blocks: Block[];
};

// ---------------------------------------------------------------------------
// Envelope build / parse
// ---------------------------------------------------------------------------

export function toClipboardEnvelope(blocks: readonly Block[]): ClipboardEnvelope {
  return { formforge: CLIPBOARD_VERSION, blocks: [...blocks] };
}

export function serializeClipboardEnvelope(blocks: readonly Block[]): string {
  return JSON.stringify(toClipboardEnvelope(blocks));
}

/**
 * Parse + validate a pasted payload. Returns the blocks, or `null` when the
 * text is not JSON, the version mismatches, or any block fails the minimal
 * shape check (`{ id: string, kind: string, props: object }`, children
 * recursively the same). Extra fields are tolerated and passed through —
 * the schema/paste pipeline owns canonicalization, not the clipboard.
 */
export function parseClipboardEnvelope(text: string): Block[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const envelope = data as Record<string, unknown>;
  if (envelope.formforge !== CLIPBOARD_VERSION) return null;
  if (!Array.isArray(envelope.blocks)) return null;
  if (!envelope.blocks.every((b) => isValidBlockShallow(b))) return null;
  return envelope.blocks as Block[];
}

function isValidBlockShallow(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  if (typeof block.id !== "string" || block.id.length === 0) return false;
  if (typeof block.kind !== "string" || block.kind.length === 0) return false;
  if (block.props === null || typeof block.props !== "object" || Array.isArray(block.props)) return false;
  if (block.children !== undefined) {
    if (!Array.isArray(block.children)) return false;
    if (!block.children.every((c) => isValidBlockShallow(c))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Re-id on paste
// ---------------------------------------------------------------------------

/**
 * Mint fresh ids for every options list nested in `props` (spec §6.4:
 * "Option labels/ids inside the copy are regenerated"). Option ids keep their
 * `opt_` prefix when the source used one (see fixtures like `opt_free`,
 * `opt_0001`); otherwise plain nanoid-style ids (matches blockMeta's
 * `twoOptions()` which mints unprefixed ids). Labels and all other props are
 * preserved verbatim. Pure: returns a new props object.
 */
export function regeneratePropIds(
  props: Record<string, unknown>,
  makeId: () => string = newId,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = key === "options" && Array.isArray(value) ? value.map((o) => reidOption(o, makeId)) : value;
  }
  return out;
}

function reidOption(value: unknown, makeId: () => string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const option = value as Record<string, unknown>;
  if (typeof option.id !== "string") return value;
  const fresh = makeId();
  return { ...option, id: option.id.startsWith("opt_") ? `opt_${fresh}` : fresh };
}

/**
 * Build `block.insert` ops that paste `blocks` at `index` (under `parentId`,
 * `null` = root). Every block (and its descendants, via cloneWithNewIds) and
 * every nested option id gets a fresh id; consecutive ops use running indexes
 * so a multi-block paste preserves order.
 */
export function pasteBlocksToOps(
  blocks: readonly Block[],
  index: number,
  parentId: string | null,
  makeId: () => string = newId,
): BlockInsertOp[] {
  return blocks.map((block, i) => {
    const clone = cloneWithNewIds(block, makeId);
    return {
      op: "block.insert" as const,
      parentId,
      index: index + i,
      block: { ...clone, props: regeneratePropIds(clone.props, makeId) },
    };
  });
}

// ---------------------------------------------------------------------------
// Internal (same-tab) + system (cross-tab, best-effort) clipboard
// ---------------------------------------------------------------------------

let internalClipboard: Block[] | null = null;

/** Store blocks in the in-memory clipboard (always succeeds). */
export function internalCopy(blocks: readonly Block[]): void {
  internalClipboard = blocks.map((b) => structuredCloneIfNeeded(b));
}

/** Read the in-memory clipboard (null when empty). */
export function internalPaste(): Block[] | null {
  return internalClipboard ? internalClipboard.map((b) => structuredCloneIfNeeded(b)) : null;
}

/** Test/dev seam: forget the internal clipboard. */
export function internalClear(): void {
  internalClipboard = null;
}

function structuredCloneIfNeeded(block: Block): Block {
  if (typeof structuredClone === "function") return structuredClone(block);
  return JSON.parse(JSON.stringify(block)) as Block;
}

/**
 * Copy: mirror the envelope JSON to the system clipboard when the async
 * Clipboard API is available (cross-tab paste), and ALWAYS to the internal
 * clipboard (same-tab flow works without permissions). Resolves `true` only
 * when the system write succeeded.
 */
export async function copyBlocks(blocks: readonly Block[]): Promise<boolean> {
  internalCopy(blocks);
  const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } })
    .navigator?.clipboard;
  if (typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(serializeClipboardEnvelope(blocks));
    return true;
  } catch {
    // Permissions/DOMException — the internal copy above still covers this tab.
    return false;
  }
}

/**
 * Paste: prefer a FormForge envelope on the system clipboard (cross-tab),
 * fall back to the internal clipboard (same-tab). Returns `null` when neither
 * holds a valid envelope.
 */
export async function pasteBlocks(): Promise<Block[] | null> {
  const clipboard = (globalThis as { navigator?: { clipboard?: { readText?: () => Promise<string> } } }).navigator
    ?.clipboard;
  if (typeof clipboard?.readText === "function") {
    try {
      const fromSystem = parseClipboardEnvelope(await clipboard.readText());
      if (fromSystem) return fromSystem;
    } catch {
      // Fall through to the internal clipboard.
    }
  }
  return internalPaste();
}
