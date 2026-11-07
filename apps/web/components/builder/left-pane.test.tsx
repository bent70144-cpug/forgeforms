// B3 — left pane tests: tree nesting/indent, endings rows, logic link count
// and the pure helpers behind the wave-3 picker event contract. Static
// rendering with react-dom/server (node env, no effects, no fetch).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderProvider } from "./context";
import { insertionTarget, LeftPane, ruleIsDangling } from "./LeftPane";
import { flattenBlocks, validateLabelPresence } from "./BlocksTree";
import { emptyBody } from "@/lib/builder/ops";
import { editorReducer, initialEditorState, type EditorState } from "@/lib/builder/store";
import type { Block, DocumentEnvelope, Rule } from "@/lib/bridge";

const blocks: Block[] = [
  { id: "q1", kind: "short-text", props: { label: "Your name" } },
  {
    id: "wrap",
    kind: "section",
    props: {},
    children: [
      { id: "q2", kind: "email", props: { label: "" } },
      { id: "q3", kind: "rating", props: { label: "Rate us" } },
    ],
  },
];

const envelope: DocumentEnvelope = {
  id: "doc1",
  rev: 1,
  title: "T",
  slug: "t",
  status: "draft",
  type: "form",
  body: {
    ...emptyBody("form"),
    blocks,
    endings: [{ id: "end1", title: "Thanks!" }],
    logic: {
      rules: [
        {
          id: "r1",
          scope: "q1",
          when: [],
          then: [{ type: "goto", target: "ghost" }],
          isFallback: false,
        },
      ],
    },
  },
};

function loadedState(): EditorState {
  return editorReducer(initialEditorState("doc1"), { type: "loaded", envelope, mode: "mock" });
}

function renderPane(state: EditorState): string {
  return renderToStaticMarkup(
    h(BuilderProvider, { docId: state.docId, initialState: state, children: h(LeftPane) }),
  );
}

describe("flattenBlocks (tree model)", () => {
  it("walks nested containers depth-first with depth + parent links", () => {
    const rows = flattenBlocks(blocks, new Set());
    expect(rows.map((r) => r.block.id)).toEqual(["q1", "wrap", "q2", "q3"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 1]);
    expect(rows[2]?.parentId).toBe("wrap");
    expect(rows[1]?.expandable).toBe(true);
    expect(rows[0]?.expandable).toBe(false);
  });

  it("collapsed containers hide their children", () => {
    const rows = flattenBlocks(blocks, new Set(["wrap"]));
    expect(rows.map((r) => r.block.id)).toEqual(["q1", "wrap"]);
    expect(rows[1]?.expanded).toBe(false);
  });
});

describe("validateLabelPresence", () => {
  it("counts one issue for label-declaring blocks with an empty label", () => {
    expect(validateLabelPresence({ id: "a", kind: "short-text", props: { label: "" } })).toBe(1);
    expect(validateLabelPresence({ id: "a", kind: "short-text", props: { label: "  " } })).toBe(1);
    expect(validateLabelPresence({ id: "a", kind: "short-text", props: { label: "Hi" } })).toBe(0);
    expect(validateLabelPresence({ id: "a", kind: "hero", props: {} })).toBe(0); // no label field
  });
});

describe("insertionTarget (wave-3 picker contract)", () => {
  it("inserts after the selected block inside its own list, else at the root end", () => {
    expect(insertionTarget(blocks, null)).toEqual({ index: 2, parentId: null });
    expect(insertionTarget(blocks, "q1")).toEqual({ index: 1, parentId: null });
    expect(insertionTarget(blocks, "wrap")).toEqual({ index: 2, parentId: null });
    // nested selection: after the child, inside the container
    expect(insertionTarget(blocks, "q2")).toEqual({ index: 1, parentId: "wrap" });
    expect(insertionTarget(blocks, "ghost")).toEqual({ index: 2, parentId: null });
  });
});

describe("ruleIsDangling", () => {
  const rule = (overrides: Partial<Rule>): Rule => ({
    id: "r",
    scope: "q1",
    when: [],
    then: [],
    isFallback: false,
    ...overrides,
  });

  it("flags rules whose goto target, scope or condition block is missing", () => {
    expect(ruleIsDangling(rule({ then: [{ type: "goto", target: "ghost" }] }), blocks)).toBe(true);
    expect(ruleIsDangling(rule({ then: [{ type: "goto", target: "q3" }] }), blocks)).toBe(false);
    expect(ruleIsDangling(rule({ then: [{ type: "goto", target: "end:end1" }] }), blocks)).toBe(false);
    expect(ruleIsDangling(rule({ scope: "ghost" }), blocks)).toBe(true);
    expect(ruleIsDangling(rule({ scope: "start" }), blocks)).toBe(false);
    expect(ruleIsDangling(rule({ when: [{ left: "@block:ghost", op: "eq" }] }), blocks)).toBe(true);
    expect(ruleIsDangling(rule({ when: [{ left: "@block:q2", op: "eq" }] }), blocks)).toBe(false);
  });
});

describe("<LeftPane> (loaded state)", () => {
  it("renders nested tree rows indented by depth", () => {
    const html = renderPane(loadedState());
    expect(html).toContain('data-block-id="q1"');
    expect(html).toContain('data-block-id="q2"');
    expect(html).toContain("padding-left:8px"); // depth 0
    expect(html).toContain("padding-left:22px"); // depth 1
    expect(html).toContain('role="tree"');
    expect(html).toContain('role="treeitem"');
  });

  it("marks the selected row with aria-selected", () => {
    const selected = editorReducer(loadedState(), { type: "select", id: "q1" });
    const html = renderPane(selected);
    const q1Row = html.match(/<li[^>]*data-block-id="q1"[^>]*>/)?.[0] ?? "";
    const wrapRow = html.match(/<li[^>]*data-block-id="wrap"[^>]*>/)?.[0] ?? "";
    expect(q1Row).toContain('aria-selected="true"');
    expect(wrapRow).toContain('aria-selected="false"');
  });

  it("shows the issue badge for the empty-label block", () => {
    const html = renderPane(loadedState());
    expect(html).toContain('aria-label="1 issue"');
  });

  it("lists endings and the Add ending row", () => {
    const html = renderPane(loadedState());
    expect(html).toContain("Thanks!");
    expect(html).toContain("Add ending");
    expect(html).toContain('aria-label="Endings"');
  });

  it("links to the logic route with the rule count and a dangling marker", () => {
    const html = renderPane(loadedState());
    expect(html).toContain('href="/d/doc1/logic"');
    expect(html).toContain("Logic (1 rule)");
    expect(html).toContain('aria-label="A rule references a missing block"');
  });

  it("omits the dangling marker when every rule resolves", () => {
    const fixed: DocumentEnvelope = {
      ...envelope,
      body: {
        ...envelope.body,
        logic: {
          rules: [
            {
              id: "r1",
              scope: "q1",
              when: [],
              then: [{ type: "goto", target: "q3" }],
              isFallback: false,
            },
          ],
        },
      },
    };
    const state = editorReducer(initialEditorState("doc1"), {
      type: "loaded",
      envelope: fixed,
      mode: "mock",
    });
    expect(renderPane(state)).not.toContain("A rule references a missing block");
  });

  it("shows an empty hint instead of a tree when the document has no blocks", () => {
    const empty = editorReducer(initialEditorState("doc1"), {
      type: "loaded",
      envelope: { ...envelope, body: { ...envelope.body, blocks: [] } },
      mode: "mock",
    });
    expect(renderPane(empty)).toContain("No blocks yet");
  });
});
