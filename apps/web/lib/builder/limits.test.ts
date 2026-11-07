// §13/§14 hard limits (builder-audit follow-up #10): pure guard decisions.
// Covering: block counting, the 500-block refusal (flat + nested + the
// convert remove+re-insert net-zero), the ~1 MB body-JSON refusal, the
// hot-path exit for insert-free batches, and which autosave batches imply
// growth (pure deletes must always send).
import { describe, expect, it } from "vitest";
import type { Block } from "../bridge";
import { emptyBody } from "./ops";
import {
  BLOCK_LIMIT_NOTICE,
  BODY_LIMIT_NOTICE,
  MAX_BLOCKS,
  MAX_BODY_JSON_CHARS,
  batchImpliesGrowth,
  checkInsertLimits,
  countBlocks,
  estimateBodyJsonChars,
  isBodyOverLimit,
} from "./limits";

const b = (id: string, props: Record<string, unknown> = {}, kind = "short-text"): Block => ({
  id,
  kind,
  props,
});

function bodyWith(blocks: Block[]) {
  return { ...emptyBody("form"), blocks };
}

const insert = (block: Block, index = 0, parentId: string | null = null) => ({
  op: "block.insert" as const,
  parentId,
  index,
  block,
});

describe("countBlocks", () => {
  it("counts the whole subtree, children included", () => {
    const tree = [b("a"), { ...b("sec", {}, "section"), children: [b("s1"), b("s2")] }, b("c")];
    expect(countBlocks(tree)).toBe(5);
    expect(countBlocks([])).toBe(0);
  });
});

describe("checkInsertLimits — 500-block cap (§13/§14)", () => {
  it("allows the 500th block and refuses the 501st with the explanatory notice", () => {
    const at499 = bodyWith(Array.from({ length: 499 }, (_, i) => b(`b${i}`)));
    expect(checkInsertLimits(at499, [insert(b("new"))])).toBeNull(); // → 500 ok

    const at500 = bodyWith(Array.from({ length: 500 }, (_, i) => b(`b${i}`)));
    const refused = checkInsertLimits(at500, [insert(b("new"))]);
    expect(refused?.kind).toBe("blocks");
    expect(refused?.notice).toBe(BLOCK_LIMIT_NOTICE);
    expect(refused?.notice).toMatch(/500 blocks/);
    expect(MAX_BLOCKS).toBe(500);
  });

  it("counts the whole inserted subtree against the cap", () => {
    const at498 = bodyWith(Array.from({ length: 498 }, (_, i) => b(`b${i}`)));
    const section = { ...b("sec", {}, "section"), children: [b("s1"), b("s2")] };
    const refused = checkInsertLimits(at498, [insert(section)]); // 498 + 3 > 500
    expect(refused?.kind).toBe("blocks");
    expect(checkInsertLimits(bodyWith(Array.from({ length: 497 }, (_, i) => b(`b${i}`))), [insert(section)])).toBeNull();
  });

  it("credits removes in the same batch (delete + add stays under the cap)", () => {
    const at500 = bodyWith(Array.from({ length: 500 }, (_, i) => b(`b${i}`)));
    // delete one root block, add one → still 500
    const ops = [{ op: "block.remove" as const, id: "b0" }, insert(b("new"), 0)];
    expect(checkInsertLimits(at500, ops)).toBeNull();
  });

  it("treats the §5.2 convert path (remove + re-insert with the same id) as net zero", () => {
    // 496 root blocks + section(subtree 4) = exactly 500 — at the cap.
    const at500 = bodyWith([
      ...Array.from({ length: 496 }, (_, i) => b(`b${i}`)),
      { ...b("sec", {}, "section"), children: [b("s1"), b("s2"), b("s3")] },
    ]);
    expect(countBlocks(at500.blocks)).toBe(500);
    const converted = { ...b("sec", { label: "x" }, "columns"), children: [b("s1"), b("s2"), b("s3")] };
    // remove sec (subtree 4) + insert converted (subtree 4) → net 0 → allowed
    const ops = [{ op: "block.remove" as const, id: "sec" }, insert(converted, 496)];
    expect(checkInsertLimits(at500, ops)).toBeNull();
    // ...but a convert that would GROW the count past the cap is still refused
    const bigger = { ...b("sec2", { label: "x" }, "columns"), children: [b("n1"), b("n2"), b("n3"), b("n4"), b("n5")] };
    const growOps = [{ op: "block.remove" as const, id: "sec" }, insert(bigger, 496)];
    expect(checkInsertLimits(at500, growOps)?.kind).toBe("blocks");
  });

  it("exits in O(ops) shape: insert-free batches (typing/move/meta) never violate", () => {
    const at500 = bodyWith(Array.from({ length: 500 }, (_, i) => b(`b${i}`)));
    const typing = [{ op: "block.update" as const, id: "b0", props: { label: "Hello".repeat(1000) } }];
    expect(checkInsertLimits(at500, typing)).toBeNull();
    const moves = [{ op: "block.move" as const, id: "b0", parentId: null, index: 3 }];
    expect(checkInsertLimits(at500, moves)).toBeNull();
  });
});

describe("checkInsertLimits — ~1 MB body JSON cap (§14)", () => {
  it("refuses an insert that pushes the serialized body over the cap", () => {
    const body = bodyWith([b("a", { label: "x".repeat(50) })]);
    // A single insert that alone is larger than the cap.
    const huge = b("huge", { label: "y".repeat(MAX_BODY_JSON_CHARS) });
    const refused = checkInsertLimits(body, [insert(huge)]);
    expect(refused?.kind).toBe("bytes");
    expect(refused?.notice).toBe(BODY_LIMIT_NOTICE);
    expect(refused?.notice).toMatch(/1 MB/);
  });

  it("refuses an ALREADY oversized body receiving any insert (conservative)", () => {
    const body = bodyWith([b("a", { label: "x".repeat(MAX_BODY_JSON_CHARS) })]);
    expect(isBodyOverLimit(body)).toBe(true);
    const refused = checkInsertLimits(body, [insert(b("tiny"))]);
    expect(refused?.kind).toBe("bytes");
  });

  it("still allows small inserts on a small body", () => {
    const body = bodyWith([b("a", { label: "Hello" })]);
    expect(estimateBodyJsonChars(body)).toBeLessThan(MAX_BODY_JSON_CHARS);
    expect(checkInsertLimits(body, [insert(b("b"))])).toBeNull();
  });

  it("never stringifies for insert-free batches (hot-path exit)", () => {
    const hugeBody = bodyWith([b("a", { label: "x".repeat(MAX_BODY_JSON_CHARS + 10) })]);
    const typing = [{ op: "block.update" as const, id: "a", props: { label: "still typing" } }];
    // The update is over the byte cap too — but only insert batches are
    // refused client-side; typing batches are gated at the autosave flush.
    expect(checkInsertLimits(hugeBody, typing)).toBeNull();
  });
});

describe("batchImpliesGrowth (autosave flush gate)", () => {
  it("flags inserts/updates/upserts as growth, pure removes as shrink", () => {
    expect(batchImpliesGrowth([insert(b("a"))])).toBe(true);
    expect(batchImpliesGrowth([{ op: "block.update", id: "a", props: { label: "x" } }])).toBe(true);
    expect(batchImpliesGrowth([{ op: "ending.remove", id: "e1" }])).toBe(false);
    expect(batchImpliesGrowth([{ op: "block.remove", id: "a" }, { op: "rule.remove", id: "r1" }])).toBe(false);
    expect(batchImpliesGrowth([{ op: "block.remove", id: "a" }, insert(b("b"))])).toBe(true);
  });
});
