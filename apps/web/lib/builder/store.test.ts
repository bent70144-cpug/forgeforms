import { describe, expect, it } from "vitest";
import type { Block } from "../bridge";
import { emptyBody, type Op } from "./ops";
import { BLOCK_CATALOG, blockDisplayLabel, createBlock, getBlockMeta, paletteForType } from "./blockMeta";
import { editorReducer, initialEditorState, selectedBlock, type EditorState } from "./store";

const b = (id: string, props: Record<string, unknown> = {}, kind = "short-text"): Block => ({ id, kind, props });

function state(): EditorState {
  const base = initialEditorState("doc1");
  return {
    ...base,
    ready: true,
    meta: { title: "Doc" },
    body: { ...emptyBody("form"), blocks: [b("a"), b("sec", {}, "section"), b("c")] },
  };
}

// Give the section block children.
function stateWithChildren(): EditorState {
  const s = state();
  return {
    ...s,
    body: {
      ...s.body,
      blocks: [
        b("a"),
        { id: "sec", kind: "section", props: {}, children: [b("s1"), b("s2")] },
        b("c"),
      ],
    },
  };
}

describe("editorReducer — apply/emit", () => {
  it("applies ops, records history and emits for autosave", () => {
    const next = editorReducer(state(), {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "Hello" } }],
      label: "Edit label",
    });
    expect(next.body.blocks[0]?.props.label).toBe("Hello");
    expect(next.emit?.ops).toEqual([{ op: "block.update", id: "a", props: { label: "Hello" } }]);
    expect(next.history.past.length).toBe(1);
    expect(next.history.past[0]?.label).toBe("Edit label");
  });

  it("emitDone clears the emit channel for the matching nonce only", () => {
    const first = editorReducer(state(), { type: "apply", ops: [{ op: "meta.update", patch: { title: "1" } }] });
    const cleared = editorReducer(first, { type: "emitDone", nonce: first.emit?.nonce ?? -1 });
    expect(cleared.emit).toBeNull();
    const stale = editorReducer(first, { type: "emitDone", nonce: 999 });
    expect(stale.emit).not.toBeNull();
  });

  it("ignores invalid ops without touching history", () => {
    const s = state();
    const next = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.remove", id: "ghost" }],
    });
    expect(next).toBe(s);
  });
});

describe("editorReducer — undo/redo round-trip", () => {
  const ops: Op[] = [
    { op: "block.insert", parentId: null, index: 0, block: b("new1", { label: "New" }) },
    { op: "block.move", id: "a", parentId: null, index: 2 },
    { op: "block.remove", id: "c" },
  ];

  it("undo reverts and emits inverse ops; redo re-applies and emits forward ops", () => {
    const applied = editorReducer(state(), { type: "apply", ops });
    expect(applied.body.blocks.map((x) => x.id)).toEqual(["new1", "sec", "a"]);

    const undone = editorReducer(applied, { type: "undo" });
    expect(undone.body.blocks.map((x) => x.id)).toEqual(["a", "sec", "c"]);
    expect(undone.emit?.ops.length).toBe(3); // inverse of the batch
    expect(undone.history.past.length).toBe(0);
    expect(undone.history.future.length).toBe(1);

    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.body.blocks.map((x) => x.id)).toEqual(["new1", "sec", "a"]);
    expect(redone.emit?.ops).toEqual(ops);
    expect(redone.history.past.length).toBe(1);
    expect(redone.history.future.length).toBe(0);
  });

  it("a new edit clears the redo stack", () => {
    const applied = editorReducer(state(), { type: "apply", ops });
    const undone = editorReducer(applied, { type: "undo" });
    const edited = editorReducer(undone, {
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: "fresh" } }],
    });
    expect(edited.history.future.length).toBe(0);
  });

  it("undo of nested inserts restores the subtree with location", () => {
    const applied = editorReducer(stateWithChildren(), {
      type: "apply",
      ops: [{ op: "block.insert", parentId: "sec", index: 0, block: b("s0") }],
    });
    const sec = applied.body.blocks[1];
    expect(sec?.children?.map((c) => c.id)).toEqual(["s0", "s1", "s2"]);
    const undone = editorReducer(applied, { type: "undo" });
    const sec2 = undone.body.blocks[1];
    expect(sec2?.children?.map((c) => c.id)).toEqual(["s1", "s2"]);
  });
});

describe("editorReducer — server reconciliation", () => {
  it("reconciled adopts the merged doc, resets history and prunes dead selection", () => {
    const s = { ...state(), selection: "a", panel: "block" as const };
    const next = editorReducer(s, {
      type: "reconciled",
      doc: {
        meta: { title: "Merged" },
        body: { ...emptyBody("form"), blocks: [b("c")] }, // "a" no longer exists
      },
      rev: 9,
    });
    expect(next.body.blocks.map((x) => x.id)).toEqual(["c"]);
    expect(next.selection).toBeNull();
    expect(next.panel).toBe("document");
    expect(next.rev).toBe(9);
    expect(next.history.past.length).toBe(0);
    expect(next.save).toBe("saved");
  });

  it("replaceFromServer swaps the whole envelope", () => {
    const next = editorReducer(state(), {
      type: "replaceFromServer",
      envelope: {
        id: "doc1",
        rev: 12,
        title: "From server",
        slug: "from-server",
        status: "published",
        type: "form",
        body: emptyBody("page"),
      },
    });
    expect(next.ready).toBe(true);
    expect(next.meta.title).toBe("From server");
    expect(next.docStatus).toBe("published");
    expect(next.body.type).toBe("page");
    expect(next.save).toBe("saved");
  });
});

describe("editorReducer — selection & misc", () => {
  it("select only allows existing blocks and switches the panel", () => {
    const s = state();
    const picked = editorReducer(s, { type: "select", id: "a" });
    expect(picked.selection).toBe("a");
    expect(picked.panel).toBe("block");
    expect(editorReducer(picked, { type: "select", id: "ghost" })).toBe(picked);
  });

  it("saveStatus records savedAt", () => {
    const next = editorReducer(state(), { type: "saveStatus", status: "saved", at: 1234 });
    expect(next.save).toBe("saved");
    expect(next.savedAt).toBe(1234);
  });

  it("selectedBlock resolves the selection", () => {
    const picked = editorReducer(state(), { type: "select", id: "sec" });
    expect(selectedBlock(picked)?.block.id).toBe("sec");
    expect(selectedBlock(state())).toBeNull();
  });
});

describe("blockMeta catalog", () => {
  it("covers the spec §7.2 MVP kinds", () => {
    const kinds = BLOCK_CATALOG.map((m) => m.kind);
    for (const kind of [
      "hero", "text", "image", "gallery", "video", "testimonials", "faq", "pricing", "projects", "contact-links",
      "section", "columns", "multi-question-page",
      "button", "form-embed",
      "short-text", "long-text", "email", "number", "single-select", "multi-select", "dropdown", "rating", "nps",
      "file-upload",
    ]) {
      expect(kinds, kind).toContain(kind);
    }
  });

  it("creates container blocks with children arrays and unique ids", () => {
    const section = createBlock("section", () => "fixed");
    expect(section.children).toEqual([]);
    expect(section.props).toEqual({ background: "none", padding: "md" });
    const [a, b2] = [createBlock("short-text"), createBlock("short-text")];
    expect(a.id).not.toBe(b2.id);
  });

  it("palette is contextual per document type", () => {
    const formGroups = paletteForType("form");
    expect(formGroups[0]?.family).toBe("question");
    const formKinds = formGroups.flatMap((g) => g.kinds.map((k) => k.kind));
    expect(formKinds).toContain("short-text");
    expect(formKinds).not.toContain("projects");
    // T21: page/portfolio content stays out of the form palette.
    expect(formKinds).not.toContain("gallery");
    expect(formKinds).not.toContain("video");
    expect(formKinds).not.toContain("pricing");

    const portfolioGroups = paletteForType("portfolio");
    expect(portfolioGroups[0]?.family).toBe("content");
    const portfolioKinds = portfolioGroups.flatMap((g) => g.kinds.map((k) => k.kind));
    expect(portfolioKinds).toContain("projects");
    expect(portfolioKinds).toContain("contact-links");
    expect(portfolioKinds).not.toContain("short-text");

    const pageKinds = paletteForType("page").flatMap((g) => g.kinds.map((k) => k.kind));
    expect(pageKinds).toContain("hero");
    expect(pageKinds).toContain("multi-question-page");
    // T21: pages get the full content/layout set.
    expect(pageKinds).toContain("gallery");
    expect(pageKinds).toContain("video");
    expect(pageKinds).toContain("testimonials");
    expect(pageKinds).toContain("faq");
    expect(pageKinds).toContain("pricing");
    expect(pageKinds).toContain("section");
    expect(pageKinds).toContain("columns");
    expect(pageKinds).toContain("form-embed");
    expect(pageKinds).not.toContain("projects");
  });

  it("display label falls back to the meta label for unnamed blocks", () => {
    expect(blockDisplayLabel(b("x", { label: "Favorite color?" }))).toBe("Favorite color?");
    expect(blockDisplayLabel({ id: "x", kind: "unknown-kind", props: {} })).toBe("unknown-kind");
    expect(getBlockMeta("rating")?.primaryProp).toBe("label");
  });
});
