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
