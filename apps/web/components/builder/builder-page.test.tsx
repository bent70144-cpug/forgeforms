// B3 — builder shell smoke + reducer glue tests. Static rendering with
// react-dom/server (node env, no jsdom, no fetch): states are built by pure
// `editorReducer` calls and injected through BuilderProvider's `initialState`
// seam because renderToStaticMarkup never runs effects.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderProvider } from "./context";
import { BuilderShell } from "./BuilderShell";
import { ContextualBanner } from "./ContextualBanner";
import { TopBar } from "./TopBar";
import { createSaveStatusStore } from "./save-indicator";
import { canUndo, emptyHistory } from "@/lib/builder/history";
import { emptyBody } from "@/lib/builder/ops";
import { editorReducer, initialEditorState, type EditorState } from "@/lib/builder/store";
import type { DocumentEnvelope } from "@/lib/bridge";

const envelope: DocumentEnvelope = {
  id: "doc1",
  rev: 3,
  title: "Product feedback",
  slug: "product-feedback",
  status: "draft",
  type: "form",
  body: {
    ...emptyBody("form"),
    blocks: [
      { id: "q1", kind: "short-text", props: { label: "Your name" } },
      {
        id: "wrap",
        kind: "section",
        props: {},
        children: [{ id: "q2", kind: "email", props: { label: "" } }],
      },
    ],
    endings: [{ id: "end1", title: "Thanks!" }],
    logic: {
      rules: [
        {
          id: "r1",
          scope: "q1",
          when: [],
          then: [{ type: "goto", target: "missing-block" }],
          isFallback: false,
        },
      ],
    },
  },
};

function loadedState(): EditorState {
  return editorReducer(initialEditorState("doc1"), { type: "loaded", envelope, mode: "mock" });
}

/** Static render helper: provider pre-loaded with the given state. */
function renderLoaded(state: EditorState, node: React.ReactNode): string {
  return renderToStaticMarkup(
    h(BuilderProvider, { docId: state.docId, initialState: state, children: node }),
  );
}

describe("<BuilderShell> (loaded state)", () => {
  it("renders §4 top bar, panes, tree rows, endings and the logic link", () => {
    const html = renderLoaded(
      loadedState(),
      h(BuilderShell, { saveStatusStore: createSaveStatusStore(), bannerKind: "none" }),
    );
    // landmarks (§12)
    expect(html).toContain('data-testid="builder-shell"');
    expect(html).toContain("header");
    expect(html).toContain('aria-label="Blocks"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('aria-label="Form editor"');
    // top bar
    expect(html).toContain('aria-label="Back to dashboard"');
    expect(html).toContain("Product feedback");
    expect(html).toContain("Saved"); // SaveIndicator idle chip
    expect(html).toContain("Undo");
    expect(html).toContain("Redo");
    expect(html).toContain("Preview");
    expect(html).toContain("Share");
    expect(html).toContain("Publish"); // PublishControl stub
    // left pane content
    expect(html).toContain("Your name");
    expect(html).toContain("Add block");
    expect(html).toContain("Thanks!");
    expect(html).toContain("Add ending");
    expect(html).toContain("Logic (1 rule)");
    // right pane default tab = document settings (real panel — stub replaced
    // by the settings milestone; testid kept stable for this smoke)
    expect(html).toContain('data-testid="settings-panel"');
  });

  it("renders the right-pane panel matching state.panel (theme / endings)", () => {
    const theme = editorReducer(loadedState(), { type: "setPanel", panel: "theme" });
    expect(renderLoaded(theme, h(BuilderShell, { saveStatusStore: createSaveStatusStore() }))).toContain(
      'data-testid="theme-panel"',
    );

    const endings = editorReducer(loadedState(), { type: "setPanel", panel: "endings" });
    expect(
      renderLoaded(endings, h(BuilderShell, { saveStatusStore: createSaveStatusStore() })),
    ).toContain('data-testid="endings-panel"');
  });

  it("flags blocks with a missing label with an issue badge (§8.1 block level)", () => {
    const html = renderLoaded(
      loadedState(),
      h(BuilderShell, { saveStatusStore: createSaveStatusStore() }),
    );
    expect(html).toContain('aria-label="1 issue"');
  });

  it("keeps undo/redo disabled on a fresh load (empty history)", () => {
    const html = renderLoaded(loadedState(), h(TopBar, { saveStatusStore: createSaveStatusStore() }));
    const undoBtn = html.match(/<button[^>]*aria-label="Undo"[^>]*>/)?.[0] ?? "";
    const redoBtn = html.match(/<button[^>]*aria-label="Redo"[^>]*>/)?.[0] ?? "";
    expect(undoBtn).toContain("disabled");
    expect(redoBtn).toContain("disabled");
  });

  it("disables Share until the document is published (§4)", () => {
    const html = renderLoaded(loadedState(), h(TopBar, { saveStatusStore: createSaveStatusStore() }));
    expect(html).toContain('title="Publish to share"');

    const published = editorReducer(loadedState(), { type: "docStatus", status: "published" });
    const pubHtml = renderLoaded(published, h(TopBar, { saveStatusStore: createSaveStatusStore() }));
    expect(pubHtml).toContain('title="Copy the public link"');
    const shareBtn = pubHtml.match(/<button[^>]*title="Copy the public link"[^>]*>/)?.[0] ?? "";
    expect(shareBtn).not.toContain("disabled");
  });
});

describe("reducer glue behind the top bar", () => {
  it("a title commit produces a meta.update op emit labelled for undo", () => {
    const renamed = editorReducer(loadedState(), {
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: "Renamed" } }],
      label: "Rename document",
    });
    expect(renamed.meta.title).toBe("Renamed");
    expect(renamed.emit?.ops).toEqual([{ op: "meta.update", patch: { title: "Renamed" } }]);
    expect(renamed.history.past[0]?.label).toBe("Rename document");
  });

  it("undo/redo buttons mirror history state, with labelled tooltips", () => {
    const renamed = editorReducer(loadedState(), {
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: "Renamed" } }],
      label: "Rename document",
    });
    const html = renderLoaded(renamed, h(TopBar, { saveStatusStore: createSaveStatusStore() }));
    expect(html).toContain('title="Undo: Rename document"');
    const redoBtn = html.match(/<button[^>]*aria-label="Redo"[^>]*>/)?.[0] ?? "";
    expect(redoBtn).toContain("disabled"); // nothing to redo yet

    const undone = editorReducer(renamed, { type: "undo" });
    const undoneHtml = renderLoaded(undone, h(TopBar, { saveStatusStore: createSaveStatusStore() }));
    expect(undoneHtml).toContain('title="Redo: Rename document"');
    const undoneUndoBtn = undoneHtml.match(/<button[^>]*aria-label="Undo"[^>]*>/)?.[0] ?? "";
    expect(undoneUndoBtn).toContain("disabled");
    expect(canUndo(undone.history)).toBe(false);
  });

  it("emitDone clears the emit channel only for the matching nonce", () => {
    const applied = editorReducer(loadedState(), {
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: "X" } }],
    });
    const cleared = editorReducer(applied, { type: "emitDone", nonce: applied.emit?.nonce ?? -1 });
    expect(cleared.emit).toBeNull();
  });

  it("empty history can never undo (guard the disabled button logic)", () => {
    expect(emptyHistory().past).toHaveLength(0);
    expect(canUndo(emptyHistory())).toBe(false);
    const one = editorReducer(loadedState(), {
      type: "apply",
      ops: [{ op: "meta.update", patch: { title: "Y" } }],
    });
    expect(canUndo(one.history)).toBe(true);
  });
});

describe("<ContextualBanner>", () => {
  it("renders nothing for kind=none", () => {
    expect(renderToStaticMarkup(h(ContextualBanner, { kind: "none" }))).toBe("");
  });

  it("renders the archived banner with the editing-disabled note and Restore", () => {
    const html = renderToStaticMarkup(
      h(ContextualBanner, { kind: "archived", onRestore: () => {} }),
    );
    expect(html).toContain("This form was archived");
    expect(html).toContain("Editing is disabled");
    expect(html).toContain("Restore");
    expect(html).toContain('role="alert"');
  });

  it("renders the multi-tab banner (§7.4 — wave 3 passes the kind)", () => {
    const html = renderToStaticMarkup(h(ContextualBanner, { kind: "multitab" }));
    expect(html).toContain("Open in another tab — edits there may conflict");
    expect(html).toContain('role="status"');
  });
});
