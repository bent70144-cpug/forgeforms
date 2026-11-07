import { describe, expect, it } from "vitest";
import type { Block } from "../bridge";
import { emptyBody, type Op } from "./ops";
import { BLOCK_LIMIT_NOTICE, BODY_LIMIT_NOTICE, MAX_BODY_JSON_CHARS } from "./limits";
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

  it("a multi-op apply stores ONE history entry whose inverse undoes the whole batch", () => {
    const applied = editorReducer(state(), {
      type: "apply",
      ops: [
        { op: "block.update", id: "a", props: { label: "One" } },
        { op: "block.move", id: "a", parentId: null, index: 2 },
        { op: "block.remove", id: "c" },
      ],
      label: "Batch edit",
    });
    expect(applied.history.past.length).toBe(1);
    const undone = editorReducer(applied, { type: "undo" });
    expect(undone.body).toStrictEqual(state().body);
    expect(undone.emit?.ops.length).toBe(3); // whole batch reverted by one undo
  });
});

describe("editorReducer — coalescing (§3.3)", () => {
  const type = (s: EditorState, text: string, startAt = 0): EditorState => {
    let next = s;
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      next = editorReducer(next, {
        type: "apply",
        ops: [{ op: "block.update", id: "a", props: { label: chars.slice(0, i + 1).join("") } }],
        label: "Typing",
        coalesce: { key: "update:a", at: startAt + i * 100 },
      });
    }
    return next;
  };

  it("5 updates on the same block within 800 ms coalesce into ONE history entry and ONE outgoing op", () => {
    const typed = type(state(), "Hello");
    expect(typed.history.past.length).toBe(1);
    expect(typed.body.blocks[0]?.props.label).toBe("Hello");
    // The emitted op is the merged patch — a single outgoing op.
    expect(typed.emit?.ops).toEqual([{ op: "block.update", id: "a", props: { label: "Hello" } }]);
    const mergedEntry = typed.history.past[0];
    expect(mergedEntry?.ops).toEqual([{ op: "block.update", id: "a", props: { label: "Hello" } }]);
    // Earliest inverse (§21): restores the label the block had before typing.
    expect(mergedEntry?.inverse).toEqual([{ op: "block.update", id: "a", props: { label: null } }]);

    // One undo reverts the whole typing burst.
    const undone = editorReducer(typed, { type: "undo" });
    expect(undone.body.blocks[0]?.props).toStrictEqual({});
    expect(undone.emit?.ops).toEqual([{ op: "block.update", id: "a", props: { label: null } }]);
    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.body.blocks[0]?.props.label).toBe("Hello");
  });

  it("typing on a DIFFERENT block starts a new entry", () => {
    let s = state();
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "x" } }],
      coalesce: { key: "update:a", at: 0 },
    });
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "c", props: { label: "y" } }],
      coalesce: { key: "update:c", at: 50 },
    });
    expect(s.history.past.length).toBe(2);
  });

  it("updates more than 800 ms apart do NOT coalesce; exactly 800 ms do", () => {
    let s = type(state(), "ab", 0); // stamps 0, 100
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "abc" } }],
      coalesce: { key: "update:a", at: 901 }, // 901 - 100 = 801 > 800
    });
    expect(s.history.past.length).toBe(2);

    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "abcd" } }],
      coalesce: { key: "update:a", at: 1701 }, // 1701 - 901 = 800 → merges with the newest
    });
    expect(s.history.past.length).toBe(2);
    expect(s.body.blocks[0]?.props.label).toBe("abcd");
  });

  it("a dispatch WITHOUT a coalesce key never merges", () => {
    let s = state();
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "x" } }],
      coalesce: { key: "update:a", at: 0 },
    });
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "xy" } }],
    });
    expect(s.history.past.length).toBe(2);
  });

  it("does not coalesce after an undo (only consecutive edits coalesce)", () => {
    let s = state();
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "x" } }],
      coalesce: { key: "update:a", at: 0 },
    });
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "c", props: { label: "y" } }],
      coalesce: { key: "update:c", at: 10 },
    });
    s = editorReducer(s, { type: "undo" }); // pops "update:c"
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "xy" } }],
      coalesce: { key: "update:a", at: 20 }, // within window of the first entry — but not consecutive
    });
    expect(s.history.past.length).toBe(2);
    expect(s.history.future.length).toBe(0); // the fresh edit still cleared the redo stack
  });

  it("keyboard move repeats coalesce into a single final move; undo restores the original position", () => {
    let s = state();
    for (const [i, idx] of [1, 2].entries()) {
      s = editorReducer(s, {
        type: "apply",
        ops: [{ op: "block.move", id: "a", parentId: null, index: idx }],
        label: "Moved",
        coalesce: { key: "move:a", at: i * 100 },
      });
    }
    expect(s.history.past.length).toBe(1);
    expect(s.emit?.ops).toEqual([{ op: "block.move", id: "a", parentId: null, index: 2 }]);
    expect(s.body.blocks.map((x) => x.id)).toEqual(["sec", "c", "a"]);

    const undone = editorReducer(s, { type: "undo" });
    expect(undone.body.blocks.map((x) => x.id)).toEqual(["a", "sec", "c"]);
    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.body.blocks.map((x) => x.id)).toEqual(["sec", "c", "a"]);
  });
});

describe("editorReducer — grouped undo (§6.3/§11)", () => {
  it("entries sharing a group undo as ONE step and redo as one step", () => {
    let s = state();
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "AI-1" } }],
      label: "AI edit 1",
      group: "ai-batch-1",
    });
    s = editorReducer(s, {
      type: "apply",
      ops: [
        { op: "block.update", id: "a", props: { label: "AI-2" } },
        { op: "meta.update", patch: { title: "AI renamed" } },
      ],
      label: "AI edit 2",
      group: "ai-batch-1",
    });
    expect(s.history.past.length).toBe(2);

    const undone = editorReducer(s, { type: "undo" });
    expect(undone.body.blocks[0]?.props).toStrictEqual({}); // label key deleted again
    expect(undone.meta.title).toBe("Doc"); // both group entries reverted together
    expect(undone.history.past.length).toBe(0);
    expect(undone.history.future.length).toBe(1);

    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.body.blocks[0]?.props.label).toBe("AI-2");
    expect(redone.meta.title).toBe("AI renamed");
    expect(redone.history.past.length).toBe(1); // merged group entry
  });

  it("a non-grouped edit between groups stays an independent undo step", () => {
    let s = state();
    s = editorReducer(s, {
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: "g1" } }],
      group: "g1",
    });
    s = editorReducer(s, { type: "apply", ops: [{ op: "meta.update", patch: { title: "solo" } }] });
    const undone = editorReducer(s, { type: "undo" });
    expect(undone.meta.title).toBe("g1");
    expect(undone.history.past.length).toBe(1);
  });
});

describe("editorReducer — history cap (§6.3)", () => {
  it("keeps at most 100 entries, dropping the oldest", () => {
    let s = state();
    for (let i = 0; i < 105; i++) {
      s = editorReducer(s, { type: "apply", ops: [{ op: "meta.update", patch: { title: `t${i}` } }] });
    }
    expect(s.history.past.length).toBe(100);
    expect(s.history.past[0]?.ops[0]).toEqual({
      op: "meta.update",
      patch: { title: "t5" },
    });
    expect(s.meta.title).toBe("t104");
    // Undo to empty restores the state at the CAP boundary: the five entries
    // dropped from history (t0–t4) are permanent — the doc keeps "t4".
    let undone = s;
    while (undone.history.past.length > 0) {
      undone = editorReducer(undone, { type: "undo" });
    }
    expect(undone.meta.title).toBe("t4");
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

  // §24 builder entitlements (follow-up #8): `loaded` stores the envelope's
  // entitlements surface; a missing one (mocks) stays null → conservative gates.
  it("loaded stores the §24 entitlements from the envelope (null when absent)", () => {
    const pro = {
      plan: "pro" as const,
      removeBranding: true,
      fileUploadMaxMb: 10,
      customRedirect: true,
      notifyEmailsLimit: 10,
    };
    const withEnts = editorReducer(initialEditorState("doc1"), {
      type: "loaded",
      envelope: {
        id: "doc1",
        rev: 1,
        title: "T",
        status: "draft",
        type: "form",
        body: emptyBody("form"),
        entitlements: pro,
      },
      mode: "api",
    });
    expect(withEnts.entitlements).toEqual(pro);

    const withoutEnts = editorReducer(initialEditorState("doc1"), {
      type: "loaded",
      envelope: {
        id: "doc1",
        rev: 1,
        title: "T",
        status: "draft",
        type: "form",
        body: emptyBody("form"),
      },
      mode: "mock",
    });
    expect(withoutEnts.entitlements).toBeNull();
    expect(initialEditorState("doc2").entitlements).toBeNull();
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

describe("editorReducer — hard limits (§13/§14, follow-up #10)", () => {
  const blocksAt = (n: number): Block[] => Array.from({ length: n }, (_, i) => b(`b${i}`));
  function stateAt(n: number): EditorState {
    const base = initialEditorState("doc1");
    return {
      ...base,
      ready: true,
      meta: { title: "Doc" },
      body: { ...emptyBody("form"), blocks: blocksAt(n) },
    };
  }
  const insertOp = (block: Block, index: number): Op => ({
    op: "block.insert",
    parentId: null,
    index,
    block,
  });

  it("refuses the 501st block: doc untouched, nothing emitted, explanatory notice recorded", () => {
    const s = stateAt(500);
    const refused = editorReducer(s, {
      type: "apply",
      ops: [insertOp(b("new"), 500)],
      label: "Add block",
    });
    expect(refused).not.toBe(s); // the notice must reach the UI
    expect(refused.body).toBe(s.body); // document unchanged
    expect(refused.history.past.length).toBe(0); // nothing to undo
    expect(refused.emit).toBeNull(); // nothing queued for autosave
    expect(refused.limitsViolation?.kind).toBe("blocks");
    expect(refused.limitsViolation?.notice).toBe(BLOCK_LIMIT_NOTICE);
    expect(refused.limitsViolation?.notice).toMatch(/500 blocks/);
  });

  it("allows the 500th block", () => {
    const s = stateAt(499);
    const applied = editorReducer(s, { type: "apply", ops: [insertOp(b("new"), 499)] });
    expect(applied.body.blocks.length).toBe(500);
    expect(applied.emit?.ops.length).toBe(1);
    expect(applied.limitsViolation).toBeNull();
  });

  it("refuses a paste batch that would cross the cap as ONE refusal", () => {
    const s = stateAt(497);
    const refused = editorReducer(s, {
      type: "apply",
      ops: [insertOp(b("p1"), 497), insertOp(b("p2"), 498), insertOp(b("p3"), 499), insertOp(b("p4"), 500)],
      label: "Paste blocks",
    });
    expect(refused.body).toBe(s.body);
    expect(refused.emit).toBeNull();
    expect(refused.limitsViolation?.kind).toBe("blocks");
    expect(refused.limitsViolation?.notice).toContain("500 blocks max");
  });

  it("refuses an insert that would push the body JSON past 1 MB (bytes notice)", () => {
    const s = stateAt(2);
    const huge = b("huge", { label: "y".repeat(MAX_BODY_JSON_CHARS) });
    const refused = editorReducer(s, { type: "apply", ops: [insertOp(huge, 0)] });
    expect(refused.body).toBe(s.body);
    expect(refused.emit).toBeNull();
    expect(refused.limitsViolation?.kind).toBe("bytes");
    expect(refused.limitsViolation?.notice).toBe(BODY_LIMIT_NOTICE);
    expect(refused.limitsViolation?.notice).toMatch(/1 MB/);
  });

  it("typing batches are not gated client-side (the 1 MB gate lives on the autosave flush)", () => {
    const hugeBody = { ...emptyBody("form"), blocks: [b("a", { label: "x".repeat(MAX_BODY_JSON_CHARS + 5) })] };
    const s: EditorState = {
      ...initialEditorState("doc1"),
      ready: true,
      meta: { title: "Doc" },
      body: hugeBody,
    };
    const applied = editorReducer(s, {
      type: "apply",
      ops: [{ op: "block.update", id: "a", props: { label: "still typing" } }],
    });
    expect(applied.body.blocks[0]?.props.label).toBe("still typing");
    expect(applied.limitsViolation).toBeNull();
  });

  it("the next successful apply clears a recorded violation", () => {
    const s = stateAt(500);
    const refused = editorReducer(s, { type: "apply", ops: [insertOp(b("new"), 500)] });
    expect(refused.limitsViolation).not.toBeNull();
    const recovered = editorReducer(refused, {
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: "renamed" } }],
    });
    expect(recovered.limitsViolation).toBeNull();
    expect(recovered.meta.title).toBe("renamed");
  });

  it("the refused insert's select dispatch is a harmless no-op (picker/duplicate flow)", () => {
    const s = stateAt(500);
    const refused = editorReducer(s, { type: "apply", ops: [insertOp(b("new"), 500)] });
    const selected = editorReducer(refused, { type: "select", id: "new" });
    expect(selected.selection).toBeNull(); // block never existed
    expect(selected.limitsViolation?.kind).toBe("blocks"); // notice persists
  });

  it("server-driven replacements clear a stale refusal (reconciled / replaceFromServer)", () => {
    const s = stateAt(500);
    const refused = editorReducer(s, { type: "apply", ops: [insertOp(b("new"), 500)] });
    expect(refused.limitsViolation).not.toBeNull();

    const reconciled = editorReducer(refused, {
      type: "reconciled",
      doc: { meta: { title: "Merged" }, body: { ...emptyBody("form"), blocks: blocksAt(3) } },
      rev: 9,
    });
    expect(reconciled.limitsViolation).toBeNull();

    const envelope = {
      id: "doc1",
      rev: 10,
      title: "T",
      slug: "t",
      status: "draft" as const,
      type: "form" as const,
      body: { ...emptyBody("form"), blocks: blocksAt(2) },
    };
    const replaced = editorReducer(reconciled, { type: "replaceFromServer", envelope });
    expect(replaced.limitsViolation).toBeNull();
    expect(replaced.body.blocks.length).toBe(2);
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
