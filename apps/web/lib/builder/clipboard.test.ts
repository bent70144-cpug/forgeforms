// Builder clipboard tests (builder spec §6.4) — envelope round-trip, strict
// parse validation, re-id on paste (blocks + nested option ids), and the
// internal same-tab clipboard flow. Pure node — no DOM, no permissions.

import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_VERSION,
  copyBlocks,
  internalClear,
  internalCopy,
  internalPaste,
  parseClipboardEnvelope,
  pasteBlocks,
  pasteBlocksToOps,
  regeneratePropIds,
  serializeClipboardEnvelope,
  toClipboardEnvelope,
} from "./clipboard";
import type { Block } from "../bridge";

function makeIdFactory() {
  let n = 0;
  return () => `fresh${++n}`;
}

const SINGLE_SELECT: Block = {
  id: "b1",
  kind: "single-select",
  props: {
    label: "Plan",
    required: false,
    options: [
      { id: "opt_free", label: "Free" },
      { id: "opt_pro", label: "Pro" },
      { id: "plain1", label: "Legacy (unprefixed)" },
    ],
  },
};

const SECTION_WITH_CHILD: Block = {
  id: "sec1",
  kind: "section",
  props: { background: "none", padding: "md" },
  children: [{ ...SINGLE_SELECT, id: "b2" }],
};

describe("clipboard envelope (§6.4)", () => {
  it("round-trips blocks through serialize → parse", () => {
    const blocks = [SINGLE_SELECT, SECTION_WITH_CHILD];
    const text = serializeClipboardEnvelope(blocks);
    const parsed = parseClipboardEnvelope(text);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(blocks); // lossless for the fields we care about
    const envelope = toClipboardEnvelope(blocks);
    expect(envelope).toEqual({ formforge: CLIPBOARD_VERSION, blocks });
  });

  it("tolerates extra fields on the envelope and on blocks", () => {
    const text = JSON.stringify({
      formforge: 1,
      blocks: [{ id: "b1", kind: "text", props: {}, futureField: { deep: true } }],
      extraTopLevel: 42,
    });
    const parsed = parseClipboardEnvelope(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.[0]?.id).toBe("b1");
  });

  it("rejects garbage, non-objects, version mismatch and bad blocks", () => {
    expect(parseClipboardEnvelope("not json at all {")).toBeNull();
    expect(parseClipboardEnvelope("")).toBeNull();
    expect(parseClipboardEnvelope("42")).toBeNull();
    expect(parseClipboardEnvelope('{"blocks":[]}')).toBeNull(); // missing formforge
    expect(parseClipboardEnvelope('{"formforge":2,"blocks":[]}')).toBeNull(); // version mismatch
    expect(parseClipboardEnvelope('{"formforge":1,"blocks":{}}')).toBeNull(); // blocks not an array
    expect(parseClipboardEnvelope('{"formforge":1,"blocks":["nope"]}')).toBeNull();
    // Each minimal-shape violation:
    expect(parseClipboardEnvelope('{"formforge":1,"blocks":[{"kind":"text","props":{}}]}')).toBeNull(); // no id
    expect(parseClipboardEnvelope('{"formforge":1,"blocks":[{"id":"b1","props":{}}]}')).toBeNull(); // no kind
    expect(parseClipboardEnvelope('{"formforge":1,"blocks":[{"id":"b1","kind":"text"}]}')).toBeNull(); // no props
    expect(parseClipboardEnvelope('{"formforge":1,"blocks":[{"id":"b1","kind":"text","props":[]}]}')).toBeNull();
    expect(
      parseClipboardEnvelope(
        '{"formforge":1,"blocks":[{"id":"b1","kind":"section","props":{},"children":[{"id":"","kind":"text","props":{}}]}]}',
      ),
    ).toBeNull(); // invalid nested child
  });
});

describe("pasteBlocksToOps — re-id on paste (§6.4)", () => {
  it("re-ids blocks, descendants and option ids while preserving labels and order", () => {
    const makeId = makeIdFactory();
    const ops = pasteBlocksToOps([SINGLE_SELECT, SECTION_WITH_CHILD], 2, null, makeId);

    expect(ops).toHaveLength(2);
    // Running indexes keep multi-block paste order at the insertion point.
    expect(ops[0]).toMatchObject({ op: "block.insert", parentId: null, index: 2 });
    expect(ops[1]).toMatchObject({ op: "block.insert", parentId: null, index: 3 });

    const pasted = ops[0]!.block;
    expect(pasted.id).toBe("fresh1");
    expect(pasted.id).not.toBe(SINGLE_SELECT.id);
    expect(pasted.kind).toBe("single-select");
    expect(pasted.props.label).toBe("Plan"); // label preserved

    // Option ids regenerated: distinct from source AND from each other.
    const options = pasted.props.options as Array<{ id: string; label: string }>;
    expect(options.map((o) => o.label)).toEqual(["Free", "Pro", "Legacy (unprefixed)"]);
    const ids = options.map((o) => o.id);
    expect(ids).not.toContain("opt_free");
    expect(ids).not.toContain("opt_pro");
    expect(ids).not.toContain("plain1");
    expect(new Set(ids).size).toBe(3);
    // `opt_` prefix preserved when the source used it.
    expect(ids[0]?.startsWith("opt_")).toBe(true);
    expect(ids[1]?.startsWith("opt_")).toBe(true);
    expect(ids[2]?.startsWith("opt_")).toBe(false); // unprefixed source stays unprefixed

    // Descendants re-ided too.
    const pastedSection = ops[1]!.block;
    expect(pastedSection.id).not.toBe(SECTION_WITH_CHILD.id);
    expect(pastedSection.children?.[0]?.id).not.toBe("b2");
    const childOptions = pastedSection.children?.[0]?.props.options as Array<{ id: string }>;
    expect(childOptions.every((o) => !ids.includes(o.id))).toBe(true);
  });

  it("passes parentId through and clamps/accepts the requested index as given", () => {
    const ops = pasteBlocksToOps([SINGLE_SELECT], 0, "parent-1", makeIdFactory());
    expect(ops[0]?.op).toBe("block.insert");
    expect(ops[0]!.parentId).toBe("parent-1");
    expect(ops[0]!.index).toBe(0);
  });
});

describe("regeneratePropIds", () => {
  it("only touches the options key and never mutates the input", () => {
    const props = { label: "Pick", options: [{ id: "opt_x", label: "X" }], count: 2 };
    const snapshot = structuredClone(props);
    const next = regeneratePropIds(props, () => "n1");
    expect(next).toEqual({ label: "Pick", options: [{ id: "opt_n1", label: "X" }], count: 2 });
    expect(props).toEqual(snapshot);
  });

  it("leaves non-option arrays and non-id options alone", () => {
    const props = { accept: ["pdf"], options: ["raw-string", { label: "no id" }] };
    expect(regeneratePropIds(props, () => "n1")).toEqual(props);
  });
});

describe("internal clipboard (same-tab flow)", () => {
  it("starts empty, copies, and pastes detached copies", () => {
    internalClear();
    expect(internalPaste()).toBeNull();

    internalCopy([SINGLE_SELECT]);
    const pasted = internalPaste();
    expect(pasted).not.toBeNull();
    expect(pasted?.[0]?.id).toBe("b1");
    // Returned copies are detached from both the source and the internal buffer.
    expect(pasted?.[0]).not.toBe(SINGLE_SELECT);
    pasted![0]!.props.label = "mutated";
    expect(internalPaste()?.[0]?.props.label).toBe("Plan");

    internalClear();
    expect(internalPaste()).toBeNull();
  });

  it("copyBlocks/pasteBlocks fall back to the internal clipboard without navigator.clipboard (node)", () => {
    internalClear();
    return copyBlocks([SINGLE_SELECT]).then((wroteSystem) => {
      expect(wroteSystem).toBe(false); // no system clipboard in node
      return pasteBlocks().then((blocks) => {
        expect(blocks?.[0]?.id).toBe("b1");
      });
    });
  });
});
