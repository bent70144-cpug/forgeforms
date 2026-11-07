// B7 — PublishControl static-render tests (spec §4 Publish button states,
// §7.5 draft-vs-published chip, §8.1 gate). Node env, react-dom/server:
// states are built by pure `editorReducer` calls and injected through
// BuilderProvider's `initialState` seam (effects never run in static render,
// so the click/POST flows are covered by the pure tests in
// lib/builder/publish.test.ts).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderProvider } from "./context";
import { PublishControl } from "./PublishControl";
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
    blocks: [{ id: "q1", kind: "short-text", props: { label: "Your name" } }],
    endings: [{ id: "end1", title: "Thanks!" }],
  },
};

function loadedState(): EditorState {
  return editorReducer(initialEditorState("doc1"), { type: "loaded", envelope, mode: "mock" });
}

function renderControl(state: EditorState): string {
  return renderToStaticMarkup(
    h(BuilderProvider, {
      docId: state.docId,
      initialState: state,
      children: h(PublishControl),
    }),
  );
}

describe("<PublishControl>", () => {
  it("draft + saved → enabled Publish button with the one-time §7.5 hint", () => {
    const html = renderControl(loadedState());
    expect(html).toContain('data-state="publish"');
    expect(html).toContain("Publish");
    expect(html).not.toContain("disabled"); // nothing disabled in this state
    expect(html).toContain("Edits are saved as a draft. Publish to update the live form.");
    expect(html).toContain('data-testid="publish-control"');
  });

  it("blocking issues → Fix N issues button (count from collectIssues)", () => {
    const broken = editorReducer(loadedState(), {
      type: "apply",
      ops: [{ op: "block.update", id: "q1", props: { label: "" } }],
    });
    const html = renderControl(broken);
    expect(html).toContain('data-state="fix-issues"');
    expect(html).toContain("Fix 1 issue"); // singular
    expect(html).toContain('data-testid="unpublished-chip"'); // issues exist → §7.5 chip
  });

  it("pluralizes the Fix N issues count", () => {
    const broken = editorReducer(loadedState(), {
      type: "apply",
      ops: [
        { op: "block.insert", parentId: null, index: 1, block: { id: "s1", kind: "dropdown", props: { label: "Pick", options: [{ id: "a", label: "Only" }] } } },
        { op: "block.update", id: "q1", props: { label: "" } },
      ],
    });
    const html = renderControl(broken);
    expect(html).toContain("Fix 2 issues");
  });

  it("published + clean → disabled Published ✓ + Live — view link to /p/<slug>", () => {
    const published = editorReducer(loadedState(), { type: "docStatus", status: "published" });
    const html = renderControl(published);
    expect(html).toContain('data-state="published"');
    expect(html).toContain("Published ✓");
    const button = html.match(/<button[^>]*data-state="published"[^>]*>/)?.[0] ?? "";
    expect(button).toContain("disabled");
    expect(html).toContain("Live — view");
    expect(html).toContain('href="/p/product-feedback"');
    expect(html).not.toContain("ff-pub-chip"); // clean → no Unpublished-changes chip
    expect(html).not.toContain("Edits are saved as a draft"); // hint only pre-publish
  });

  it("published + pending changes → §7.5 amber chip + button back to Publish", () => {
    const dirty = editorReducer(
      editorReducer(loadedState(), { type: "docStatus", status: "published" }),
      { type: "saveStatus", status: "dirty", at: 1 },
    );
    const html = renderControl(dirty);
    expect(html).toContain("Unpublished changes");
    expect(html).toContain("ff-pub-chip");
    expect(html).toContain('title="Edits are saved as a draft. Publish to update the live form."');
    expect(html).toContain('data-state="publish"');
  });

  it("warning-only issues never flip the button to Fix (§8.1 non-blocking)", () => {
    const sensitive = editorReducer(loadedState(), {
      type: "apply",
      ops: [{ op: "block.update", id: "q1", props: { label: "Your password" } }],
    });
    const html = renderControl(sensitive);
    expect(html).toContain('data-state="publish"');
    expect(html).not.toContain("Fix 1");
    expect(html).toContain('data-testid="unpublished-chip"'); // issues exist → chip
  });

  it("keeps the drawer markup out of the top bar until opened (static render)", () => {
    const html = renderControl(loadedState());
    expect(html).not.toContain('role="dialog"');
  });
});
