// §13 windowing tests for <BlocksTree> (builder-audit follow-up #10).
//
// The repo's component tests run in the node env with react-dom/server
// (NO jsdom — effects never run), so the suite asserts the two halves the
// static render can pin:
//   1. the pure windowing math (computeWindowRange / scrollTopForIndex) —
//      including the window-boundary crossing the reveal effect performs;
//   2. static markup: a many-row tree renders a SUBSET of rows (plus spacer
//      <li>s), a deep selection ("Go to" outcome) is inside the first paint's
//      window, and badges / roving tabindex / aria semantics survive.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block, DocumentEnvelope } from "@/lib/bridge";
import { emptyBody } from "@/lib/builder/ops";
import { editorReducer, initialEditorState, type EditorState } from "@/lib/builder/store";
import { BuilderProvider } from "./context";
import { BlocksTree, computeWindowRange, scrollTopForIndex, TREE_OVERSCAN_ROWS, TREE_ROW_HEIGHT_PX, TREE_VIRTUALIZE_THRESHOLD } from "./BlocksTree";

const flatBlocks = (n: number, labelPrefix = "Question"): Block[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    kind: "short-text",
    props: { label: `${labelPrefix} ${i + 1}` },
  }));

function stateWith(
  blocks: Block[],
  selectId: string | null = null,
): EditorState {
  const envelope: DocumentEnvelope = {
    id: "doc1",
    rev: 1,
    title: "T",
    slug: "t",
    status: "draft",
    type: "form",
    body: { ...emptyBody("form"), blocks },
  };
  let state = editorReducer(initialEditorState("doc1"), { type: "loaded", envelope, mode: "mock" });
  if (selectId) state = editorReducer(state, { type: "select", id: selectId });
  return state;
}

function renderTree(state: EditorState): string {
  return renderToStaticMarkup(
    h(BuilderProvider, { docId: state.docId, initialState: state, children: h(BlocksTree) }),
  );
}

describe("computeWindowRange (§13 windowing math)", () => {
  const H = TREE_ROW_HEIGHT_PX;

  it("renders the viewport plus overscan on both sides at the top", () => {
    const range = computeWindowRange({ rowCount: 1000, viewportHeight: 320, scrollTop: 0 });
    expect(range.start).toBe(0);
    expect(range.end).toBe(Math.ceil(320 / H) + 1 + TREE_OVERSCAN_ROWS);
    expect(range.end).toBeLessThan(1000);
  });

  it("slides the window with scrollTop (scroll updates the window)", () => {
    const top = computeWindowRange({ rowCount: 1000, viewportHeight: 320, scrollTop: 0 });
    const scrolled = computeWindowRange({ rowCount: 1000, viewportHeight: 320, scrollTop: 500 * H });
    expect(scrolled.start).toBe(500 - TREE_OVERSCAN_ROWS);
    expect(scrolled.end).toBeGreaterThan(500);
    expect(scrolled.start).toBeGreaterThan(top.start);
  });

  it("clamps to the row count on both edges", () => {
    const first = computeWindowRange({ rowCount: 12, viewportHeight: 320, scrollTop: 0 });
    expect(first.start).toBe(0);
    expect(first.end).toBe(12); // below threshold sizes: everything
    const last = computeWindowRange({ rowCount: 1000, viewportHeight: 320, scrollTop: 1000 * H });
    expect(last.end).toBe(1000);
    expect(last.start).toBeLessThan(1000);
  });

  it("keeps the window non-empty for degenerate inputs", () => {
    expect(computeWindowRange({ rowCount: 0, viewportHeight: 0, scrollTop: 0 })).toEqual({ start: 0, end: 0 });
    expect(computeWindowRange({ rowCount: 5, viewportHeight: 0, scrollTop: 0 }).end).toBeGreaterThan(0);
  });
});

describe("scrollTopForIndex (reveal across the window boundary)", () => {
  const H = TREE_ROW_HEIGHT_PX;

  it("leaves the scroll position alone when the row is already visible", () => {
    expect(scrollTopForIndex(5, H, 0, 320)).toBe(0);
    expect(scrollTopForIndex(10, H, 8 * H, 320)).toBe(8 * H);
  });

  it("scrolls UP to reveal a row above the viewport", () => {
    expect(scrollTopForIndex(20, H, 100 * H, 320)).toBe(20 * H);
  });

  it("scrolls DOWN so the row's bottom edge meets the viewport bottom", () => {
    const scrollTop = scrollTopForIndex(300, H, 0, 320);
    expect(scrollTop).toBe(300 * H + H - 320);
  });

  it("compose with computeWindowRange: the revealed row lands inside the window (keyboard/goto crossing)", () => {
    // A window parked at the top; selection lands 300 rows below it.
    const viewportHeight = 320;
    const scrollTop = scrollTopForIndex(300, H, 0, viewportHeight);
    const range = computeWindowRange({ rowCount: 1000, viewportHeight, scrollTop });
    expect(range.start).toBeLessThanOrEqual(300);
    expect(range.end).toBeGreaterThan(300);
    // ...and with overscan, the previous focus row (299) stays rendered too.
    expect(range.start).toBeLessThanOrEqual(300 - 1);
  });
});

describe("<BlocksTree> windowed rendering (static markup)", () => {
  it("renders only a subset of a many-row tree plus exact spacer heights", () => {
    const html = renderTree(stateWith(flatBlocks(300)));
    expect(html).toContain('data-virtualized="true"');
    expect(html).toContain('role="tree"');

    const rendered = html.match(/role="treeitem"/g)?.length ?? 0;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(300); // subset, not the full model
    expect(rendered).toBeLessThanOrEqual(TREE_VIRTUALIZE_THRESHOLD);

    // First window rows render; deep rows do not.
    expect(html).toContain('data-block-id="b2"');
    expect(html).not.toContain('data-block-id="b250"');

    // Spacers keep the scroll geometry exact: no top spacer at scrollTop 0,
    // and a bottom spacer covering every unrendered row.
    expect(html).not.toContain('style="height:0px"');
    expect(html).toMatch(/<li[^>]*role="none"[^>]*>/);
    expect(html).toContain(`style="height:${(300 - rendered) * TREE_ROW_HEIGHT_PX}px"`);
  });

  it("keeps the full model below the §13 threshold (no virtualization)", () => {
    const html = renderTree(stateWith(flatBlocks(TREE_VIRTUALIZE_THRESHOLD)));
    expect(html).not.toContain('data-virtualized="true"');
    expect(html.match(/role="treeitem"/g)?.length).toBe(TREE_VIRTUALIZE_THRESHOLD);
    expect(html).toContain('data-block-id="b199"');
    expect(html).not.toContain('style="height:'); // no spacers, no fixed heights
  });

  it("renders badges, aria-levels and exactly one roving tab stop inside the window", () => {
    const blocks = flatBlocks(300);
    blocks[2] = { id: "sec", kind: "section", props: {}, children: [{ id: "sec-child", kind: "short-text", props: { label: "Nested" } }] };
    blocks[3] = { id: "badge-row", kind: "short-text", props: { label: "" } }; // badge row inside the window
    const html = renderTree(stateWith(blocks, "b1"));
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="1 issue"');
    expect(html).toContain('aria-level="2"'); // the section's child
    expect(html).toContain('aria-expanded="true"'); // container rows still expandable
  });

  it("a deep selection — the IssuesList 'Go to' outcome — is inside the first paint's window", () => {
    // ff:goto-block → PublishControl dispatches { type: "select", id } before
    // the canvas event; the tree must render (and the reveal effect scroll
    // to) that row even though it sits far below the top of the list.
    const html = renderTree(stateWith(flatBlocks(300), "b260"));
    expect(html).toContain('data-block-id="b260"');
    const row = html.match(/<li[^>]*data-block-id="b260"[^>]*>/)?.[0] ?? "";
    expect(row).toContain('aria-selected="true"');
    expect(row).toContain('tabindex="0"'); // the one roving tab stop follows the selection
    // Rows far beyond the selected one still stay unrendered.
    expect(html).not.toContain('data-block-id="b299"');
  });

  it("any selection above the overscan seeds the scroll (mid-list selections included)", () => {
    // b150 sits below the windowing threshold's magnitude but above the first
    // window — the seed must park the scroll so it renders on first paint,
    // not only after the mount-time reveal effect.
    const html = renderTree(stateWith(flatBlocks(300), "b150"));
    const row = html.match(/<li[^>]*data-block-id="b150"[^>]*>/)?.[0] ?? "";
    expect(row).toContain('aria-selected="true"');
    expect(row).toContain('tabindex="0"');
    expect(html).not.toContain('data-block-id="b290"');
  });
});
