import { describe, expect, it } from "vitest";
import type { Block, DocumentEnvelope } from "../bridge";
import {
  applyOps,
  applyOpsBestEffort,
  cloneWithNewIds,
  computeMoveIndex,
  duplicateBlockOp,
  emptyBody,
  findBlock,
  getDeep,
  invertOps,
  OpError,
  setDeep,
  type EditableDoc,
  type Op,
} from "./ops";
import { newId } from "./id";

function doc(blocks: Block[]): EditableDoc {
  return { meta: { title: "Test doc" }, body: { ...emptyBody("form"), blocks } };
}

/**
 * §21 acceptance: apply(op) then apply(inverse) must restore the ORIGINAL doc
 * exactly. Uses toStrictEqual (not toEqual) so absent-vs-undefined keys and
 * prototype differences are caught — undo must be byte-exact.
 */
function roundTrip(original: EditableDoc, ops: Op[]): void {
  const changed = applyOps(original, ops);
  const inverse = invertOps(original, ops);
  const restored = applyOps(changed, inverse);
  expect(restored.meta).toStrictEqual(original.meta);
  expect(restored.body).toStrictEqual(original.body);
}

const b = (id: string, props: Record<string, unknown> = {}, children?: Block[], kind = "short-text"): Block => ({
  id,
  kind,
  props,
  ...(children ? { children } : {}),
});

describe("applyOps — block ops", () => {
  it("inserts at root index", () => {
    const d = doc([b("a"), b("c")]);
    const op: Op = { op: "block.insert", parentId: null, index: 1, block: b("x") };
    const next = applyOps(d, [op]);
    expect(next.body.blocks.map((x) => x.id)).toEqual(["a", "x", "c"]);
  });

  it("clamps out-of-range insert indexes", () => {
    const d = doc([b("a")]);
    const next = applyOps(d, [{ op: "block.insert", parentId: null, index: 99, block: b("x") }]);
    expect(next.body.blocks.map((x) => x.id)).toEqual(["a", "x"]);
  });

  it("inserts into a nested parent's children", () => {
    const d = doc([b("sec", { background: "muted" }, [b("s1")])]);
    const next = applyOps(d, [{ op: "block.insert", parentId: "sec", index: 0, block: b("s0") }]);
    const sec = next.body.blocks[0];
    expect(sec?.children?.map((c) => c.id)).toEqual(["s0", "s1"]);
    expect(next.body.blocks.length).toBe(1);
  });

  it("throws NOT_FOUND when insert parent is missing", () => {
    expect(() => applyOps(doc([]), [{ op: "block.insert", parentId: "ghost", index: 0, block: b("x") }]))
      .toThrowError(OpError);
  });

  it("updates props with a shallow merge", () => {
    const d = doc([b("q", { label: "Name", required: false })]);
    const next = applyOps(d, [{ op: "block.update", id: "q", props: { required: true } }]);
    expect(next.body.blocks[0]?.props).toEqual({ label: "Name", required: true });
  });

  it("moves within the same list using final-index semantics", () => {
    const d = doc([b("a"), b("b"), b("c")]);
    // move a to the end (final index 2 after removal)
    const next = applyOps(d, [{ op: "block.move", id: "a", parentId: null, index: 2 }]);
    expect(next.body.blocks.map((x) => x.id)).toEqual(["b", "c", "a"]);
    // move it back to the front
    const back = applyOps(next, [{ op: "block.move", id: "a", parentId: null, index: 0 }]);
    expect(back.body.blocks.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("moves across parents", () => {
    const d = doc([b("sec", {}, [b("s1")]), b("a")]);
    const next = applyOps(d, [{ op: "block.move", id: "a", parentId: "sec", index: 0 }]);
    expect(next.body.blocks.map((x) => x.id)).toEqual(["sec"]);
    expect(next.body.blocks[0]?.children?.map((c) => c.id)).toEqual(["a", "s1"]);
  });

  it("removes a subtree", () => {
    const inner = b("inner");
    const d = doc([b("sec", {}, [inner, b("s2")]), b("z")]);
    const next = applyOps(d, [{ op: "block.remove", id: "inner" }]);
    expect(next.body.blocks[0]?.children?.map((c) => c.id)).toEqual(["s2"]);
    const next2 = applyOps(next, [{ op: "block.remove", id: "sec" }]);
    expect(next2.body.blocks.map((x) => x.id)).toEqual(["z"]);
  });
});

describe("applyOps — document-level ops", () => {
  it("theme.update replaces scalars and merges tokens per key", () => {
    const d = doc([]);
    const next = applyOps(d, [
      { op: "theme.update", patch: { radius: "lg", tokens: { "color.bg": "#000000" } } },
    ]);
    expect(next.body.theme.radius).toBe("lg");
    expect(next.body.theme.tokens["color.bg"]).toBe("#000000");
    expect(next.body.theme.tokens["color.fg"]).toBe("#0f172a"); // untouched
    expect(next.body.theme.fontHeading).toBe("Inter");
  });

  it("settings.update merges seo separately", () => {
    const d = doc([]);
    const next = applyOps(d, [
      { op: "settings.update", patch: { progressBar: false, seo: { title: "Hello" } } },
    ]);
    expect(next.body.settings.progressBar).toBe(false);
    expect(next.body.settings.seo.title).toBe("Hello");
    expect(next.body.settings.autoAdvance).toBe(true);
  });

  it("ending.upsert inserts and replaces; ending.remove deletes", () => {
    const d = doc([]);
    const e1 = { id: "e1", title: "Thanks" };
    const next = applyOps(d, [
      { op: "ending.upsert", ending: e1 },
      { op: "ending.upsert", ending: { id: "e1", title: "Updated" } },
      { op: "ending.upsert", ending: { id: "e2", title: "Other" } },
    ]);
    expect(next.body.endings.map((e) => e.title)).toEqual(["Updated", "Other"]);
    const final = applyOps(next, [{ op: "ending.remove", id: "e1" }]);
    expect(final.body.endings.map((e) => e.id)).toEqual(["e2"]);
  });

  it("meta.update sets title/slug", () => {
    const next = applyOps(doc([]), [{ op: "meta.update", patch: { title: "New", slug: "new" } }]);
    expect(next.meta).toEqual({ title: "New", slug: "new" });
  });

  it("rule ops upsert and remove", () => {
    const rule = { id: "r1", scope: "start", when: [], then: [{ type: "goto" as const, target: "end:e1" }], isFallback: false };
    const next = applyOps(doc([]), [{ op: "rule.upsert", rule }]);
    expect(next.body.logic.rules.length).toBe(1);
    const final = applyOps(next, [{ op: "rule.remove", id: "r1" }]);
    expect(final.body.logic.rules.length).toBe(0);
  });
});

describe("invertOps", () => {
  it("round-trips a mixed op batch back to the original doc", () => {
    const original = doc([
      b("a", { label: "A" }),
      b("sec", {}, [b("s1", { label: "S1" })]),
      b("c"),
    ]);
    const ops: Op[] = [
      { op: "block.update", id: "a", props: { label: "A2", required: true } },
      { op: "block.move", id: "c", parentId: null, index: 0 },
      { op: "block.insert", parentId: "sec", index: 0, block: b("s0", { label: "S0" }) },
      { op: "block.remove", id: "s1" },
      { op: "theme.update", patch: { radius: "lg", tokens: { "color.bg": "#123456" } } },
      { op: "meta.update", patch: { title: "Renamed" } },
      { op: "ending.upsert", ending: { id: "e9", title: "End" } },
    ];
    const changed = applyOps(original, ops);
    const inverse = invertOps(original, ops);
    const restored = applyOps(changed, inverse);

    expect(restored.body).toEqual(original.body);
    expect(restored.meta).toEqual(original.meta);
  });

  it("inverts block.remove with the removed subtree and location", () => {
    const inner = b("inner", { label: "Inner" });
    const d = doc([b("sec", {}, [b("s1"), inner, b("s2")])]);
    const op: Op = { op: "block.remove", id: "inner" };
    const restored = applyOps(applyOps(d, [op]), invertOps(d, [op]));
    const sec = restored.body.blocks[0];
    expect(sec?.children?.map((c) => c.id)).toEqual(["s1", "inner", "s2"]);
  });

  it("inverts block.update only for the touched keys", () => {
    const d = doc([b("q", { label: "Keep", maxLength: 10 })]);
    const op: Op = { op: "block.update", id: "q", props: { maxLength: 99 } };
    const restored = applyOps(applyOps(d, [op]), invertOps(d, [op]));
    expect(restored.body.blocks[0]?.props).toEqual({ label: "Keep", maxLength: 10 });
  });

  it("deletes keys via null patch values (undo of added keys)", () => {
    const d = doc([b("q", { label: "Name" })]);
    const add: Op = { op: "block.update", id: "q", props: { required: true } };
    const after = applyOps(d, [add]);
    expect(after.body.blocks[0]?.props).toEqual({ label: "Name", required: true });
    const restored = applyOps(after, invertOps(d, [add]));
    expect(restored.body.blocks[0]?.props).toEqual({ label: "Name" });
  });

  it("inverts ending.upsert that replaced an existing ending", () => {
    const d = doc([]);
    const seed = applyOps(d, [{ op: "ending.upsert", ending: { id: "e1", title: "V1" } }]);
    const op: Op = { op: "ending.upsert", ending: { id: "e1", title: "V2" } };
    const restored = applyOps(applyOps(seed, [op]), invertOps(seed, [op]));
    expect(restored.body.endings).toEqual([{ id: "e1", title: "V1" }]);
  });
});

describe("computeMoveIndex", () => {
  it.each([
    // origIdx, hoverIdx, before, expected final index
    [0, 1, true, 0], // A over B top → before B
    [0, 1, false, 1], // A over B bottom → after B
    [0, 2, true, 1],
    [0, 2, false, 2],
    [1, 0, true, 0], // B over A top
    [1, 0, false, 1], // B over A bottom
    [1, 2, true, 1], // B over C top → stays
    [1, 2, false, 2],
    [2, 0, true, 0],
    [2, 0, false, 1],
    [0, 0, true, 0], // self → no-op
    [0, 0, false, 0],
  ])("orig=%i hover=%i before=%s → %i", (origIdx, hoverIdx, before, expected) => {
    expect(computeMoveIndex(origIdx, hoverIdx, before)).toBe(expected);
  });
});

describe("applyOpsBestEffort", () => {
  it("applies what it can and drops the rest", () => {
    const d = doc([b("a")]);
    const result = applyOpsBestEffort(d, [
      { op: "block.remove", id: "ghost" }, // dropped
      { op: "block.update", id: "a", props: { label: "ok" } },
      { op: "block.move", id: "a", parentId: "missing", index: 0 }, // dropped
    ]);
    expect(result.applied.length).toBe(1);
    expect(result.dropped.length).toBe(2);
    expect(result.doc.body.blocks[0]?.props.label).toBe("ok");
  });
});

describe("cloneWithNewIds / duplicateBlockOp", () => {
  it("clones a subtree with fresh unique ids and identical props", () => {
    const tree = b("root", { label: "R" }, [b("child", { label: "C" }, [b("gc")])]);
    const seen = new Set<string>();
    const clone = cloneWithNewIds(tree, () => {
      const id = newId();
      seen.add(id);
      return id;
    });
    expect(clone.id).not.toBe("root");
    expect(clone.props).toEqual(tree.props);
    expect(clone.children?.[0]?.id).not.toBe("child");
    expect(clone.children?.[0]?.children?.[0]?.id).not.toBe("gc");
    expect(seen.size).toBe(3);
    // deep-clone check: mutating clone props does not affect source
    (clone.props as Record<string, unknown>).label = "MUT";
    expect(tree.props.label).toBe("R");
  });

  it("duplicateBlockOp inserts the clone right after the original", () => {
    const d = doc([b("a"), b("target", {}, [b("kid")]), b("z")]);
    const { op, clone } = duplicateBlockOp(d, "target", () => "fresh");
    const next = applyOps(d, [op]);
    expect(next.body.blocks.map((x) => x.id)).toEqual(["a", "target", "fresh", "z"]);
    expect(clone.children?.[0]?.id).not.toBe("kid");
  });
});

describe("findBlock + deep prop helpers", () => {
  it("finds nested blocks with trail/index", () => {
    const d = doc([b("a"), b("sec", {}, [b("s1"), b("s2")])]);
    const found = findBlock(d.body.blocks, "s2");
    expect(found?.block.kind).toBe("short-text");
    expect(found?.index).toBe(1);
    expect(found?.trail.map((t) => t.id)).toEqual(["sec"]);
  });

  it("getDeep/setDeep handle dot paths", () => {
    const props = { cta: { label: "Go", href: "/x" } };
    expect(getDeep(props, "cta.label")).toBe("Go");
    expect(getDeep(props, "cta.missing")).toBeUndefined();
    expect(setDeep("cta.label", "New")).toEqual({ cta: { label: "New" } });
  });
});

describe("emptyBody", () => {
  it("produces a valid spec §7 skeleton with defaults", () => {
    const body = emptyBody("page");
    expect(body.schemaVersion).toBe(1);
    expect(body.type).toBe("page");
    expect(body.settings.progressBar).toBe(true);
    expect(body.theme.radius).toBe("md");
    expect(body.blocks).toEqual([]);
    expect(body.endings).toEqual([]);
    expect(body.logic.rules).toEqual([]);
  });
});

// Sanity: envelope type import is used by autosave/transport modules; keep a
// compile-time reference so the bridge contract stays pinned in tests.
type _EnvelopeCheck = DocumentEnvelope["body"] extends EditableDoc["body"] ? true : false;
const _envelopeCheck: _EnvelopeCheck = true;
void _envelopeCheck;

// ---------------------------------------------------------------------------
// Spec §21 — Operation & Inverse Reference acceptance table (milestone B1).
// For EACH of the 11 op types: apply(doc, op) then apply(doc', inverse) must
// deep-equal (strictly) the original doc. Inverse SHAPES are asserted per the
// table's "Computed Inverse Op" column.
// ---------------------------------------------------------------------------

describe("§21 compliance — inverse round-trips per op type", () => {
  it("block.insert: inverse is block.remove of the inserted id; round-trips at a clamped index", () => {
    const d = doc([b("a"), b("c")]);
    const op: Op = { op: "block.insert", parentId: null, index: 99, block: b("x", { label: "X" }) };
    expect(invertOps(d, [op])).toEqual([{ op: "block.remove", id: "x" }]);
    // Clamped insert (99 → appended after "c") still round-trips exactly.
    roundTrip(d, [op]);
    const changed = applyOps(d, [op]);
    expect(changed.body.blocks.map((x) => x.id)).toEqual(["a", "c", "x"]);
  });

  it("block.insert into a nested parent round-trips (parent trail intact)", () => {
    const d = doc([b("sec", {}, [b("s1")]), b("z")]);
    roundTrip(d, [{ op: "block.insert", parentId: "sec", index: 0, block: b("s0") }]);
  });

  it("block.update: inverse is the previous props subset (null token for added keys)", () => {
    const d = doc([b("q", { label: "Name", required: false })]);
    const op: Op = { op: "block.update", id: "q", props: { label: "Full name", maxLength: 20 } };
    const inverse = invertOps(d, [op]);
    // Only the PATCHED keys are inverted; "required" was untouched → absent.
    expect(inverse).toEqual([
      { op: "block.update", id: "q", props: { label: "Name", maxLength: null } },
    ]);
    roundTrip(d, [op]);
  });

  it("block.update with null patch values deletes keys; round-trip is exact", () => {
    const d = doc([b("q", { label: "Name", placeholder: "Type…" })]);
    const op: Op = { op: "block.update", id: "q", props: { placeholder: null, required: true } };
    roundTrip(d, [op]);
    const changed = applyOps(d, [op]);
    expect(changed.body.blocks[0]?.props).toStrictEqual({ label: "Name", required: true });
  });

  it("block.move: inverse restores the previous parent + index (same list and across parents)", () => {
    const d = doc([b("a"), b("b"), b("c")]);
    const same: Op = { op: "block.move", id: "a", parentId: null, index: 2 };
    expect(invertOps(d, [same])).toEqual([{ op: "block.move", id: "a", parentId: null, index: 0 }]);
    roundTrip(d, [same]);

    const nested = doc([b("sec", {}, [b("s1")]), b("a"), b("z")]);
    const cross: Op = { op: "block.move", id: "a", parentId: "sec", index: 1 };
    const inverse = invertOps(nested, [cross]);
    expect(inverse).toEqual([{ op: "block.move", id: "a", parentId: null, index: 1 }]);
    roundTrip(nested, [cross]);
  });

  it("block.remove: inverse re-inserts the FULL subtree (children included) at the original index", () => {
    const inner = b("inner", { label: "Inner" }, [b("leaf", { label: "Leaf" })]);
    const d = doc([b("a"), b("sec", { background: "muted" }, [b("s1"), inner, b("s2")]), b("z")]);
    const op: Op = { op: "block.remove", id: "sec" };
    const inverse = invertOps(d, [op]);
    expect(inverse.length).toBe(1);
    const inv = inverse[0] as Extract<Op, { op: "block.insert" }>;
    expect(inv.op).toBe("block.insert");
    expect(inv.parentId).toBeNull();
    expect(inv.index).toBe(1); // original index of "sec" in the root list
    expect(inv.block).toStrictEqual(d.body.blocks[1]); // full subtree incl. children
    roundTrip(d, [op]);
  });

  it("settings.update: inverse restores previous top-level keys and nested seo (null = delete)", () => {
    const d = doc([]);
    // Adds closeAt + seo.title on fields that were ABSENT → inverse carries null.
    const add: Op = {
      op: "settings.update",
      patch: { closeAt: "2030-01-01T00:00:00.000Z", seo: { title: "SEO" } },
    };
    const inverse = invertOps(d, [add]);
    expect(inverse).toEqual([
      {
        op: "settings.update",
        patch: { closeAt: null, seo: { title: null } },
      },
    ]);
    roundTrip(d, [add]);

    // Overwrites existing values → inverse restores them exactly.
    const seeded = applyOps(d, [add]);
    const overwrite: Op = {
      op: "settings.update",
      patch: { progressBar: false, captcha: true, seo: { title: "New", description: "D" } },
    };
    roundTrip(seeded, [overwrite]);
  });

  it("theme.update: inverse restores scalars and merges/deletes tokens per key", () => {
    const d = doc([]);
    const add: Op = {
      op: "theme.update",
      patch: { radius: "lg", tokens: { "color.bg": "#123456", "color.custom": "#abc" } },
    };
    const inverse = invertOps(d, [add]);
    const inv = inverse[0] as Extract<Op, { op: "theme.update" }>;
    expect(inv.patch.radius).toBe("md");
    expect((inv.patch.tokens as Record<string, unknown>)["color.bg"]).toBe("#ffffff");
    expect((inv.patch.tokens as Record<string, unknown>)["color.custom"]).toBeNull();
    roundTrip(d, [add]);
    roundTrip(applyOps(d, [add]), [{ op: "theme.update", patch: { radius: "sm", tokens: { "color.bg": null } } }]);
  });

  it("meta.update: inverse restores title/slug; un-setting an added slug deletes the key", () => {
    const d = doc([]);
    const op: Op = { op: "meta.update", patch: { title: "Renamed", slug: "renamed" } };
    const inverse = invertOps(d, [op]);
    // slug was absent before → inverse carries the null delete-token.
    expect(inverse).toEqual([{ op: "meta.update", patch: { title: "Test doc", slug: null } }]);
    roundTrip(d, [op]);
    roundTrip(doc([{ id: "a", kind: "short-text", props: {} }]), [
      { op: "meta.update", patch: { slug: "x" } },
    ]);
  });

  it("ending.upsert: NEW ending inverts to ending.remove; EXISTING inverts to upsert of the previous value", () => {
    const d = doc([]);
    const add: Op = { op: "ending.upsert", ending: { id: "e1", title: "Thanks" } };
    expect(invertOps(d, [add])).toEqual([{ op: "ending.remove", id: "e1" }]);
    roundTrip(d, [add]);

    const seeded = applyOps(d, [add]);
    const replace: Op = { op: "ending.upsert", ending: { id: "e1", title: "Updated", body: "Longer" } };
    expect(invertOps(seeded, [replace])).toEqual([
      { op: "ending.upsert", ending: { id: "e1", title: "Thanks" } },
    ]);
    roundTrip(seeded, [replace]);
  });

  it("ending.remove: inverse re-inserts at the ORIGINAL index (§21: ending.upsert { index, ending })", () => {
    const d = doc([]);
    const seeded = applyOps(d, [
      { op: "ending.upsert", ending: { id: "e1", title: "First" } },
      { op: "ending.upsert", ending: { id: "e2", title: "Second" } },
      { op: "ending.upsert", ending: { id: "e3", title: "Third" } },
    ]);
    const op: Op = { op: "ending.remove", id: "e1" };
    const inverse = invertOps(seeded, [op]);
    expect(inverse).toEqual([
      { op: "ending.upsert", index: 0, ending: { id: "e1", title: "First" } },
    ]);
    roundTrip(seeded, [op]);
    // Middle removal must also restore the exact order.
    roundTrip(seeded, [{ op: "ending.remove", id: "e2" }]);
  });

  it("rule.upsert: NEW rule inverts to rule.remove; EXISTING inverts to upsert of the previous value", () => {
    const d = doc([]);
    const rule = { id: "r1", scope: "start", when: [], then: [{ type: "goto" as const, target: "end:e1" }], isFallback: false };
    const add: Op = { op: "rule.upsert", rule };
    expect(invertOps(d, [add])).toEqual([{ op: "rule.remove", id: "r1" }]);
    roundTrip(d, [add]);

    const seeded = applyOps(d, [add]);
    const replace: Op = { op: "rule.upsert", rule: { ...rule, isFallback: true } };
    expect(invertOps(seeded, [replace])).toEqual([{ op: "rule.upsert", rule }]);
    roundTrip(seeded, [replace]);
  });

  it("rule.remove: inverse re-inserts at the ORIGINAL index (§21: rule.upsert { index, rule })", () => {
    const rule = (id: string): { id: string; scope: string; when: never[]; then: never[]; isFallback: boolean } => ({
      id,
      scope: "start",
      when: [],
      then: [],
      isFallback: false,
    });
    const d = doc([]);
    const seeded = applyOps(d, [
      { op: "rule.upsert", rule: rule("r1") },
      { op: "rule.upsert", rule: rule("r2") },
      { op: "rule.upsert", rule: rule("r3") },
    ]);
    const op: Op = { op: "rule.remove", id: "r2" };
    const inverse = invertOps(seeded, [op]);
    expect(inverse).toEqual([{ op: "rule.upsert", index: 1, rule: rule("r2") }]);
    roundTrip(seeded, [op]);
  });

  it("mixed 11-op batch round-trips exactly (strict)", () => {
    const original = doc([
      b("a", { label: "A" }),
      b("sec", {}, [b("s1", { label: "S1" })]),
      b("future-widget", { weird: { deep: [1, "two", { x: null }] }, "🔑": "emoji-key" }, undefined, "future-widget"),
    ]);
    const withEnding = applyOps(original, [{ op: "ending.upsert", ending: { id: "e1", title: "First" } }]);
    const ops: Op[] = [
      { op: "block.insert", parentId: null, index: 99, block: b("x") },
      { op: "block.update", id: "a", props: { label: "A2", fresh: true } },
      { op: "block.move", id: "x", parentId: "sec", index: 0 },
      { op: "block.remove", id: "s1" },
      { op: "settings.update", patch: { seo: { title: "T" }, closeAt: "2030-01-01T00:00:00.000Z" } },
      { op: "theme.update", patch: { radius: "lg", tokens: { "color.bg": "#000" } } },
      { op: "ending.upsert", index: 0, ending: { id: "e2", title: "Second" } },
      { op: "ending.remove", id: "e1" },
      { op: "rule.upsert", index: 0, rule: { id: "r1", scope: "start", when: [], then: [], isFallback: false } },
      { op: "meta.update", patch: { slug: "mixed" } },
      { op: "block.update", id: "a", props: { fresh: null } },
    ];
    roundTrip(withEnding, ops);
  });
});

// ---------------------------------------------------------------------------
// Unknown-kind preservation (spec §3.2, §5.4 — golden rule #4, milestone B1).
// ---------------------------------------------------------------------------

describe("unknown block kinds are preserved untouched", () => {
  const WEIRD_PROPS = {
    label: "Mystery ↗ block",
    weird: { deep: [1, "two", { x: null, y: [] }], n: 0 },
    "": "empty key",
    "🔑": "🔑 value",
    nested: { a: { b: { c: "🌱" } } },
  };
  const widget = (id: string): Block => b(id, structuredClone(WEIRD_PROPS), undefined, "future-widget");

  it("leaves a future-widget byte-identical through insert/update/move sequences around it", () => {
    const d = doc([b("a", { label: "A" }), widget("w"), b("sec", {}, [b("s1")])]);
    const ops: Op[] = [
      { op: "block.insert", parentId: null, index: 0, block: b("new") },
      { op: "block.update", id: "a", props: { label: "Changed" } },
      { op: "block.update", id: "s1", props: { label: "Inner", extra: "x" } },
      { op: "block.move", id: "w", parentId: null, index: 3 },
      { op: "block.move", id: "sec", parentId: null, index: 0 },
      { op: "block.remove", id: "a" },
    ];
    const next = applyOps(d, ops);
    const moved = findBlock(next.body.blocks, "w");
    expect(moved?.block.kind).toBe("future-widget");
    // Byte-identical props: strict equality AND identical JSON serialization.
    expect(moved?.block.props).toStrictEqual(WEIRD_PROPS);
    expect(JSON.stringify(moved?.block.props)).toBe(JSON.stringify(WEIRD_PROPS));
    // And the whole session still round-trips.
    roundTrip(d, ops);
  });

  it("moving the widget's parent carries the child unchanged", () => {
    const d = doc([b("a"), b("sec", {}, [widget("w"), b("s1")]), b("z")]);
    const next = applyOps(d, [
      { op: "block.move", id: "sec", parentId: null, index: 0 },
      { op: "block.move", id: "s1", parentId: "sec", index: 0 },
    ]);
    const sec = next.body.blocks[0];
    const w = sec?.children?.find((c) => c.id === "w");
    expect(w?.props).toStrictEqual(WEIRD_PROPS);
    expect(JSON.stringify(w?.props)).toBe(JSON.stringify(WEIRD_PROPS));
  });

  it("removing the widget's parent removes the subtree; its inverse restores the widget byte-identical", () => {
    const d = doc([b("a"), b("sec", {}, [b("s1"), widget("w")])]);
    const op: Op = { op: "block.remove", id: "sec" };
    const changed = applyOps(d, [op]);
    expect(findBlock(changed.body.blocks, "w")).toBeNull();
    const restored = applyOps(changed, invertOps(d, [op]));
    const w = findBlock(restored.body.blocks, "w");
    expect(w?.block.kind).toBe("future-widget");
    expect(w?.block.props).toStrictEqual(WEIRD_PROPS);
    expect(JSON.stringify(w?.block.props)).toBe(JSON.stringify(WEIRD_PROPS));
    expect(restored.body).toStrictEqual(d.body);
  });
});
