// Builder hard limits (builder-audit follow-up #10, spec §13 budgets + §14
// error states): the client refuses document mutations that the server would
// reject anyway — a document over 500 blocks or a body over the ~1 MB JSON
// payload cap — with an explanatory shell notice instead of a silent failure.
//
// Design notes:
// - PURE module (no React/DOM) so the reducer can call the checks and every
//   decision is unit-testable in plain node.
// - Hot-path safety (§13: keystroke < 16 ms): `checkInsertLimits` exits in
//   O(ops) when the batch contains no `block.insert` (typing / moves / theme
//   edits never pay for a tree walk or a JSON.stringify). The block-count
//   walk and the body-byte estimate only run on insert-bearing batches, which
//   are user-paced (add block, duplicate, paste, AI apply).
// - Byte estimating: `JSON.stringify(body).length` is the cheap §14 estimate
//   (chars ≈ bytes for the ASCII-dominant bodies forms produce; multi-byte
//   labels can make the real UTF-8 payload larger — the insert-path check is
//   therefore conservative for growth and the exact gate also runs on the
//   coalesced autosave batch path, see AutosaveController).

import type { Block, DocumentBody } from "../bridge";
import { findBlock, type Op } from "./ops";

/** §13/§14 hard limit: max blocks per document (whole tree, children incl.). */
export const MAX_BLOCKS = 500;

/**
 * Body JSON budget matching the server's ~1 MB PATCH payload cap (413).
 * Measured as `JSON.stringify(body).length` (chars ≈ bytes for ASCII).
 */
export const MAX_BODY_JSON_CHARS = 1_000_000;

/** §14 copy for the 500-block refusal — always shown, never silent. */
export const BLOCK_LIMIT_NOTICE =
  "Document limit reached — 500 blocks max per document; delete blocks to add more.";

/** §14 copy for the 1 MB refusal (insert path). */
export const BODY_LIMIT_NOTICE =
  "Document too large to save — over the 1 MB limit; delete blocks or shorten content before adding more.";

/** Total blocks in a (sub)tree, children included. */
export function countBlocks(blocks: readonly Block[]): number {
  let n = 0;
  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      n += 1;
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return n;
}

/** Cheap §14 estimate of the serialized body size (UTF-16 code units). */
export function estimateBodyJsonChars(body: DocumentBody): number {
  return JSON.stringify(body).length;
}

/** True when the serialized body is over the §13/§14 payload cap. */
export function isBodyOverLimit(body: DocumentBody): boolean {
  return estimateBodyJsonChars(body) > MAX_BODY_JSON_CHARS;
}

/**
 * Batches that can GROW the document. Pure-removal batches (user deleting the
 * oversized content) must always send — refusing them would trap the user
 * over the limit with no way out.
 */
export function batchImpliesGrowth(ops: readonly Op[]): boolean {
  return ops.some((op) => op.op !== "block.remove" && op.op !== "ending.remove" && op.op !== "rule.remove");
}

export type LimitKind = "blocks" | "bytes";
export type LimitViolation = { kind: LimitKind; notice: string };

/**
 * §13/§14 pre-flight check for an `apply` batch that inserts blocks
 * (add / duplicate / paste / AI apply / restore). Returns the violation to
 * refuse the WHOLE batch with, or null when it may proceed.
 *
 * Block counting is exact for the realistic shapes: inserts add their whole
 * subtree; removes subtract the removed subtree (resolved against the
 * current body); a remove + re-insert of the same id (the §5.2 convert path)
 * nets zero. The byte check adds the inserted blocks' JSON to the current
 * body's estimate — conservative for batches that also remove content.
 */
export function checkInsertLimits(body: DocumentBody, ops: readonly Op[]): LimitViolation | null {
  // Hot-path exit: nothing in the batch inserts blocks (typing, moves, …).
  let hasInsert = false;
  for (const op of ops) {
    if (op.op === "block.insert") {
      hasInsert = true;
      break;
    }
  }
  if (!hasInsert) return null;

  // --- block count (§13: ≤ 500 blocks per document) ------------------------
  let delta = 0;
  const removedIds: string[] = [];
  for (const op of ops) {
    if (op.op === "block.insert") {
      delta += countBlocks([op.block]);
    } else if (op.op === "block.remove") {
      removedIds.push(op.id);
    }
  }
  for (const id of removedIds) {
    const found = findBlock(body.blocks, id);
    if (found) delta -= countBlocks([found.block]);
  }
  if (countBlocks(body.blocks) + delta > MAX_BLOCKS) {
    return { kind: "blocks", notice: BLOCK_LIMIT_NOTICE };
  }

  // --- body bytes (§14: ≤ ~1 MB JSON) --------------------------------------
  let chars = estimateBodyJsonChars(body);
  for (const op of ops) {
    if (op.op === "block.insert") chars += JSON.stringify(op.block).length;
  }
  if (chars > MAX_BODY_JSON_CHARS) {
    return { kind: "bytes", notice: BODY_LIMIT_NOTICE };
  }

  return null;
}
