// Builder wave-3 INTEGRATION tests — the wiring seams, exercised as far as a
// static render allows (vitest node env, NO jsdom: effects never run, so
// window-event listeners are covered by their pure glue in lib/builder/wiring
// + the presence of the DOM contracts these tests pin):
//
// - shell-top §14 rejection notice (BuilderShell notice prop)
// - controlled preview lift (TopBar previewOpen / onPreviewOpenChange)
// - BlockCard `data-block-id` contract (ff:goto-block scroll target + picker
//   post-insert focus selector)
// - Canvas `initialEditingBlockId` seam (the ff:edit-selected render outcome,
//   incl. nested children)
// - The overlays BuilderPage mounts once: ConflictDialog + RestorePrompt
//   render through the BuilderShell's page-level composition.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DocumentEnvelope } from "@/lib/bridge";
import { emptyBody } from "@/lib/builder/ops";
import { editorReducer, initialEditorState, type EditorState } from "@/lib/builder/store";
import { BuilderProvider } from "./context";
import { BuilderShell } from "./BuilderShell";
import { TopBar } from "./TopBar";
import { Canvas } from "./Canvas";
import { ConflictDialog } from "./ConflictDialog";
import { RestorePrompt } from "./RestorePrompt";
import type { ConflictEvent } from "@/lib/builder/autosave";
import { createSaveStatusStore } from "./save-indicator";

// TopBar renders PreviewModal → next/dynamic; stub it like PreviewModal.test.
vi.mock("next/dynamic", async () => {
  type LoadableOptions = { loading?: () => unknown };
  return {
    default: (_loader: unknown, options?: LoadableOptions) => {
      function DynamicStub() {
        return options?.loading ? options.loading() : null;
      }
      return DynamicStub;
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures (same pattern as builder-page.test.tsx)
// ---------------------------------------------------------------------------

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
        id: "sec1",
        kind: "section",
        props: {},
        children: [{ id: "q2", kind: "email", props: { label: "Work email" } }],
      },
    ],
    endings: [{ id: "end1", title: "Thanks!" }],
  },
};

function loadedState(): EditorState {
  return editorReducer(initialEditorState("doc1"), { type: "loaded", envelope, mode: "mock" });
}

function renderLoaded(state: EditorState, node: React.ReactNode): string {
  return renderToStaticMarkup(
    h(BuilderProvider, { docId: state.docId, initialState: state, children: node }),
  );
}

const conflictEvent: ConflictEvent = {
  rev: 9,
  serverDoc: { meta: { title: "Server" }, body: emptyBody("form") },
  serverBody: emptyBody("form"),
  pendingOps: [{ op: "meta.update", patch: { title: "Mine" } }],
};

// ---------------------------------------------------------------------------
// Shell-top §14 rejection notice
// ---------------------------------------------------------------------------

describe("BuilderShell notice (§14 op-rejected surface)", () => {
  it("renders the dismissable notice under the top bar when set", () => {
    const html = renderLoaded(
      loadedState(),
      h(BuilderShell, {
        saveStatusStore: createSaveStatusStore(),
        notice: "One change was rejected: Parent block was deleted",
        onNoticeDismiss: () => {},
      }),
    );
    expect(html).toContain('data-testid="builder-notice"');
    expect(html).toContain("One change was rejected: Parent block was deleted");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Dismiss notice"');
  });

  it("renders no notice by default", () => {
    const html = renderLoaded(
      loadedState(),
      h(BuilderShell, { saveStatusStore: createSaveStatusStore() }),
    );
    expect(html).not.toContain('data-testid="builder-notice"');
  });
});

// ---------------------------------------------------------------------------
// Controlled preview lift (ff:open-preview contract)
// ---------------------------------------------------------------------------

describe("TopBar controlled preview (wave-3 lift)", () => {
  it("still renders self-managed without the props (existing tests keep passing)", () => {
    const html = renderLoaded(loadedState(), h(TopBar, { saveStatusStore: createSaveStatusStore() }));
    expect(html).toContain(">Preview</button>");
  });

  it("opens the §8.4 modal when the page-level previewOpen is true", () => {
    const html = renderLoaded(
      loadedState(),
      h(TopBar, {
        saveStatusStore: createSaveStatusStore(),
        previewOpen: true,
        onPreviewOpenChange: () => {},
      }),
    );
    expect(html).toContain('data-testid="preview-modal"');
  });
});

// ---------------------------------------------------------------------------
// data-block-id contract (ff:goto-block + picker post-insert focus)
// ---------------------------------------------------------------------------

describe("Canvas data-block-id contract", () => {
  it("stamps every card (nested included) with data-block-id", () => {
    const html = renderLoaded(loadedState(), h(Canvas));
    expect(html).toContain('data-block-id="q1"');
    expect(html).toContain('data-block-id="sec1"');
    expect(html).toContain('data-block-id="q2"');
  });
});

// ---------------------------------------------------------------------------
// ff:edit-selected render outcome (initialEditingBlockId seam)
// ---------------------------------------------------------------------------

describe("Canvas inline-edit request (ff:edit-selected)", () => {
  it("opens the requested root block's inline editor", () => {
    const html = renderLoaded(loadedState(), h(Canvas, { initialEditingBlockId: "q1" }));
    expect(html).toContain("<input");
    expect(html).toContain('aria-label="Edit Short text text"');
    expect(html).toContain('value="Your name"');
  });

  it("threads the request into nested children", () => {
    const html = renderLoaded(loadedState(), h(Canvas, { initialEditingBlockId: "q2" }));
    expect(html).toContain('value="Work email"');
  });

  it("leaves every card read-only without a request", () => {
    const html = renderLoaded(loadedState(), h(Canvas));
    expect(html).toContain("Your name"); // rendered as the editable span
    expect(html).not.toContain('value="Your name"');
  });
});

// ---------------------------------------------------------------------------
// Overlays mounted by BuilderPage (page-level composition smoke)
// ---------------------------------------------------------------------------

describe("BuilderPage overlay stack", () => {
  it("renders conflict + recovery overlays side by side as BuilderPage composes them", () => {
    // BuilderPage itself starts an autosave loop via effects — never rendered
    // here (node env). The overlay fragment it mounts IS composed below.
    const html = renderToStaticMarkup(
      h(
        "div",
        null,
        h(ConflictDialog, { conflict: conflictEvent, onResolve: () => {} }),
        h(RestorePrompt, {
          request: { kind: "restore", editCount: 2 },
          onRestore: () => {},
          onDiscard: () => {},
        }),
      ),
    );
    expect(html).toContain('data-testid="conflict-dialog"');
    expect(html).toContain('data-testid="restore-prompt"');
  });
});
