// Unit tests for the AI-apply bridge (spec §11: grouped, undoable AI applies).
// Pure functions over the builder Op union + the core AI op vocabulary.
import { describe, expect, it } from "vitest";
import type { Block } from "../bridge";
import type { Op } from "./ops";
import { summarizeOpsDiff, toBuilderOp, toBuilderOps, toGroupedApply } from "./ai-apply";

const EMAIL_BLOCK: Block = { id: "blkEmail01", kind: "short-text", props: { label: "Email" } };
const HERO_BLOCK: Block = { id: "blkHero001", kind: "hero", props: {} };

const FIXTURE_OPS: Op[] = [
  { op: "block.insert", parentId: null, index: 0, block: EMAIL_BLOCK },
  { op: "block.update", id: "blkText001", props: { richText: "Changed" } },
  { op: "block.remove", id: "blkGone001" },
  { op: "block.move", id: "blkMove01", parentId: null, index: 2 },
  { op: "settings.update", patch: { locale: "de" } },
  { op: "theme.update", patch: { radius: "lg" } },
];

describe("toGroupedApply", () => {
  it("shapes {ops, label, group} for the store's apply action", () => {
    const grouped = toGroupedApply(FIXTURE_OPS, "batch-1");
    expect(grouped.ops).toEqual(FIXTURE_OPS);
    expect(grouped.label).toBe("Apply AI edits (6 changes)");
    expect(grouped.group).toBe("ai:batch-1");
    // defensive copy — callers mutating the bundle must not affect the input
    expect(grouped.ops).not.toBe(FIXTURE_OPS);
  });

  it("uses the singular label for a one-op batch and tolerates an empty one", () => {
    expect(toGroupedApply([FIXTURE_OPS[0] as Op], "b").label).toBe("Apply AI edits (1 change)");
    const empty = toGroupedApply([], "b");
    expect(empty.label).toBe("Apply AI edits (0 changes)");
    expect(empty.ops).toEqual([]);
    expect(empty.group).toBe("ai:b");
  });
});

describe("summarizeOpsDiff", () => {
  it("counts block.insert/update/remove/move and lumps the rest into other", () => {
    expect(summarizeOpsDiff(FIXTURE_OPS)).toMatchObject({
      added: 1,
      changed: 1,
      removed: 1,
      moved: 1,
      other: 2,
      total: 6,
    });
  });

  it("renders one human line per op (kind label + quoted display label)", () => {
    expect(summarizeOpsDiff(FIXTURE_OPS).lines).toEqual([
      "+ Short text “Email”",
      "~ Block blkText001 (richText)",
      "− Block blkGone001",
      "→ Block blkMove01 → position 2",
      "• Settings (locale)",
      "• Theme (radius)",
    ]);
  });

  it("omits the name suffix when the block carries no distinct display label", () => {
    const summary = summarizeOpsDiff([
      { op: "block.insert", parentId: null, index: 0, block: HERO_BLOCK },
    ]);
    expect(summary.lines).toEqual(["+ Hero"]);
  });

  it("summarizes an empty batch as all-zero with no lines", () => {
    expect(summarizeOpsDiff([])).toEqual({
      added: 0,
      changed: 0,
      removed: 0,
      moved: 0,
      other: 0,
      total: 0,
      lines: [],
    });
  });
});

describe("toBuilderOp / toBuilderOps (core AI vocabulary → builder Op)", () => {
  it("maps the block.* ops 1:1 (type → op discriminant)", () => {
    expect(
      toBuilderOp({ type: "block.insert", index: 1, block: { id: "b1", kind: "email", props: { label: "E" } } }),
    ).toEqual({ op: "block.insert", parentId: null, index: 1, block: { id: "b1", kind: "email", props: { label: "E" } } });
    expect(toBuilderOp({ type: "block.insert", parentId: "p1", index: 0, block: { id: "b1", kind: "text", props: {} } })).toMatchObject({
      parentId: "p1",
    });
    expect(toBuilderOp({ type: "block.update", id: "x", props: { a: 1 } })).toEqual({
      op: "block.update",
      id: "x",
      props: { a: 1 },
    });
    expect(toBuilderOp({ type: "block.move", id: "x", index: 2 })).toEqual({
      op: "block.move",
      id: "x",
      parentId: null,
      index: 2,
    });
    expect(toBuilderOp({ type: "block.remove", id: "x" })).toEqual({ op: "block.remove", id: "x" });
  });

  it("renames the payload keys of settings/theme/meta ops (settings|theme|meta → patch)", () => {
    expect(toBuilderOp({ type: "settings.update", settings: { locale: "de" } })).toEqual({
      op: "settings.update",
      patch: { locale: "de" },
    });
    expect(toBuilderOp({ type: "theme.update", theme: { radius: "lg" } })).toEqual({
      op: "theme.update",
      patch: { radius: "lg" },
    });
    expect(toBuilderOp({ type: "meta.update", meta: { title: "T" } })).toEqual({
      op: "meta.update",
      patch: { title: "T" },
    });
  });

  it("maps ending/rule ops and rejects malformed or unknown ops with null", () => {
    expect(toBuilderOp({ type: "ending.upsert", ending: { id: "e1", title: "Done" } })).toMatchObject({
      op: "ending.upsert",
    });
    expect(toBuilderOp({ type: "ending.remove", id: "e1" })).toEqual({ op: "ending.remove", id: "e1" });
    expect(toBuilderOp({ type: "rule.upsert", rule: { id: "r1" } })).toMatchObject({ op: "rule.upsert" });
    expect(toBuilderOp({ type: "rule.remove", id: "r1" })).toEqual({ op: "rule.remove", id: "r1" });

    expect(toBuilderOp(null)).toBeNull();
    expect(toBuilderOp("nope")).toBeNull();
    expect(toBuilderOp({})).toBeNull();
    expect(toBuilderOp({ type: "block.explode", id: "x" })).toBeNull();
    expect(toBuilderOp({ type: "block.insert", index: 0 })).toBeNull(); // block missing
    expect(toBuilderOp({ type: "block.insert", index: 0, block: { id: "b", kind: "text" } })).toBeNull(); // props missing
    expect(toBuilderOp({ type: "block.remove" })).toBeNull(); // id missing
    expect(toBuilderOp({ type: "settings.update" })).toBeNull(); // settings missing
  });

  it("toBuilderOps filters junk while preserving order", () => {
    const converted = toBuilderOps([
      { type: "block.remove", id: "a" },
      "junk",
      { type: "meta.update", meta: { title: "T" } },
      { type: "unknown.op" },
    ]);
    expect(converted).toEqual([
      { op: "block.remove", id: "a" },
      { op: "meta.update", patch: { title: "T" } },
    ]);
  });

  it("composes with summarizeOpsDiff for a realistic AI reply", () => {
    const summary = summarizeOpsDiff(
      toBuilderOps([
        { type: "block.insert", index: 0, block: { id: "n1", kind: "email", props: { label: "Work email" } } },
        { type: "block.remove", id: "old1" },
        { type: "theme.update", theme: { radius: "full" } },
      ]),
    );
    expect(summary).toMatchObject({ added: 1, removed: 1, other: 1, total: 3 });
    expect(summary.lines).toEqual([
      "+ Email “Work email”",
      "− Block old1",
      "• Theme (radius)",
    ]);
  });
});
