// Canvas smoke tests (builder spec §5) — react-dom/server static markup, no
// DOM env. The harness seeds a loaded EditorState through BuilderProvider's
// `initialState` seam because renderToStaticMarkup never runs effects.
import { createElement as h, useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentEnvelope } from "@/lib/bridge";
import { DEFAULT_THEME_TOKENS } from "@/lib/bridge";
import { initialEditorState, type EditorState } from "@/lib/builder/store";
import {
  BlockErrorBoundary,
  BlockErrorFallback,
} from "@/components/builder/BlockErrorBoundary";
import { BuilderProvider } from "@/components/builder/context";
import { Canvas } from "@/components/builder/Canvas";
import { InlineEditable } from "@/components/builder/InlineEditable";
import { UnknownBlock } from "@/components/builder/UnknownBlock";
import type { CanvasActions } from "@/lib/builder/canvas-ops";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function envelope(overrides?: {
  blocks?: DocumentEnvelope["body"]["blocks"];
  endings?: DocumentEnvelope["body"]["endings"];
}): DocumentEnvelope {
  return {
    id: "doc1",
    rev: 7,
    title: "Fixture form",
    status: "draft",
    type: "form",
    body: {
      schemaVersion: 1,
      type: "form",
      theme: {
        tokens: { ...DEFAULT_THEME_TOKENS },
        fontHeading: "Inter",
        fontBody: "Inter",
        radius: "md",
      },
      settings: {
        seo: {},
        locale: "en",
        progressBar: true,
        autoAdvance: true,
        showBranding: true,
        captcha: false,
        notifyEmails: [],
      },
      blocks: overrides?.blocks ?? [
        {
          id: "q1",
          kind: "short-text",
          props: { label: "What is your name?", placeholder: "", required: false },
        },
        { id: "uk1", kind: "future-widget", props: { payload: { n: 1 } } },
        {
          id: "sec1",
          kind: "section",
          props: { background: "none", padding: "md" },
          children: [
            {
              id: "q2",
              kind: "long-text",
              props: { label: "Tell us more", placeholder: "", required: false },
            },
          ],
        },
      ],
      endings: overrides?.endings ?? [{ id: "end1", title: "Thanks for your time!" }],
      logic: { rules: [] },
    },
  };
}

function seededState(env: DocumentEnvelope, selection: string | null = null): EditorState {
  return {
    ...initialEditorState(env.id),
    ready: true,
    mode: "mock",
    meta: { title: env.title },
    body: env.body,
    docStatus: env.status,
    rev: env.rev,
    selection,
  };
}

function Harness({
  env,
  selection = null,
}: {
  env: DocumentEnvelope;
  selection?: string | null;
}) {
  // BuilderProvider's initialState seam: renderToStaticMarkup never runs
  // effects, so the loaded state is injected instead of dispatching "loaded".
  const initial = useMemo(() => seededState(env, selection), [env, selection]);
  return h(BuilderProvider, { docId: env.id, initialState: initial, children: h(Canvas) });
}

const NOOP_ACTIONS: CanvasActions = {
  select: () => {},
  insert: () => {},
  move: () => {},
  duplicate: () => {},
  remove: () => {},
  convert: () => {},
  updatePrimaryText: () => {},
  openEndings: () => {},
};

// ---------------------------------------------------------------------------
// <Canvas> with a loaded document
// ---------------------------------------------------------------------------

describe("<Canvas> (loaded document)", () => {
  it("renders the region, start-screen chrome, block labels and insertion rows", () => {
    const html = renderToStaticMarkup(h(Harness, { env: envelope() }));
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Form editor"');
    expect(html).toContain("builder-canvas");
    // Start screen chrome (§5.1)
    expect(html).toContain("Start screen");
    expect(html).toContain("Respondents see this first");
    // Question preview + inline-editable title text (§5.1/§5.2)
    expect(html).toContain("What is your name?");
    // Nested section child (§5.1 recursive cards)
    expect(html).toContain("Tell us more");
    // Insertion points: start, between pairs, end, and inside the container (§5.3)
    expect(html).toContain('aria-label="Insert block here"');
    // Theme variables are applied live on the canvas root (§5.1)
    expect(html).toContain("--ff-bg");
    expect(html).toContain("--ff-radius");
  });

  it("renders the §5.4 unknown-kind placeholder with its kind preserved", () => {
    const html = renderToStaticMarkup(h(Harness, { env: envelope() }));
    expect(html).toContain("This block type isn&#x27;t supported in this version");
    expect(html).toContain("future-widget");
  });

  it("renders ending cards with the read-only Ending chip (§5.1)", () => {
    const html = renderToStaticMarkup(h(Harness, { env: envelope() }));
    expect(html).toContain("Thanks for your time!");
    expect(html).toContain("Ending");
  });

  it("shows the floating toolbar for the selected block (§5.2)", () => {
    const html = renderToStaticMarkup(h(Harness, { env: envelope(), selection: "q1" }));
    expect(html).toContain('aria-label="Move up"');
    expect(html).toContain('aria-label="Move down"');
    expect(html).toContain('aria-label="Duplicate question"');
    expect(html).toContain('aria-label="Delete block"');
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain("Drag to move (coming soon)");
  });

  it("renders the §5.3 empty state when the document has no blocks", () => {
    const html = renderToStaticMarkup(
      h(Harness, { env: envelope({ blocks: [], endings: [] }) }),
    );
    expect(html).toContain("Add your first question");
    expect(html).toContain("Short text");
    expect(html).toContain("Email");
    expect(html).toContain("Multiple choice");
    expect(html).toContain("Start from a template");
    expect(html).toContain('href="/templates"');
    expect(html).not.toContain('aria-label="Insert block here"');
  });
});

// ---------------------------------------------------------------------------
// <UnknownBlock> (§5.4)
// ---------------------------------------------------------------------------

describe("<UnknownBlock>", () => {
  const block = { id: "uk9", kind: "hologram", props: { kept: true } };

  it("explains the unsupported kind and keeps props", () => {
    const html = renderToStaticMarkup(
      h(UnknownBlock, {
        block,
        index: 1,
        siblingCount: 2,
        selected: false,
        referencedIds: new Set<string>(),
        actions: NOOP_ACTIONS,
      }),
    );
    expect(html).toContain("This block type isn&#x27;t supported in this version");
    expect(html).toContain("hologram");
    expect(html).not.toContain("aria-label=\"Move up\"");
  });

  it("limits the toolbar to Duplicate/Delete when selected (§5.4)", () => {
    const html = renderToStaticMarkup(
      h(UnknownBlock, {
        block,
        index: 1,
        siblingCount: 2,
        selected: true,
        referencedIds: new Set<string>(),
        actions: NOOP_ACTIONS,
      }),
    );
    expect(html).toContain('aria-label="Duplicate question"');
    expect(html).toContain('aria-label="Delete block"');
    expect(html).not.toContain('aria-label="Move up"');
    expect(html).not.toContain('aria-label="More actions"');
  });
});

// ---------------------------------------------------------------------------
// Error containment (§5.4) — the fallback is exercised directly because
// react-dom/server propagates render errors instead of invoking boundaries.
// ---------------------------------------------------------------------------

describe("BlockErrorBoundary", () => {
  it("maps any thrown value to state via getDerivedStateFromError", () => {
    const asError = BlockErrorBoundary.getDerivedStateFromError("boom");
    expect(asError.error).toBeInstanceOf(Error);
    expect(asError.error?.message).toBe("boom");
    expect(BlockErrorBoundary.getDerivedStateFromError(new Error("x")).error?.message).toBe("x");
  });

  it("<BlockErrorFallback> shows the message, stored props JSON and Delete", () => {
    const html = renderToStaticMarkup(
      h(BlockErrorFallback, { block: { id: "b1", kind: "short-text", props: { label: "Hi" } }, onDelete: () => {} }),
    );
    expect(html).toContain("This block has an error");
    expect(html).toContain("View stored props");
    expect(html).toContain("&quot;label&quot;: &quot;Hi&quot;");
    expect(html).toContain('aria-label="Delete block"');
  });
});

// ---------------------------------------------------------------------------
// <InlineEditable> (§5.2)
// ---------------------------------------------------------------------------

describe("<InlineEditable>", () => {
  it("renders a click-to-edit span in read mode", () => {
    const html = renderToStaticMarkup(
      h(InlineEditable, {
        value: "What is your name?",
        editing: false,
        onBegin: () => {},
        onCommit: () => {},
        onCancel: () => {},
        ariaLabel: "Edit question text",
      }),
    );
    expect(html).toContain("What is your name?");
    expect(html).toContain("Click to edit");
  });

  it("renders a prefilled input in edit mode", () => {
    const html = renderToStaticMarkup(
      h(InlineEditable, {
        value: "What is your name?",
        editing: true,
        onBegin: () => {},
        onCommit: () => {},
        onCancel: () => {},
        ariaLabel: "Edit question text",
      }),
    );
    expect(html).toContain("<input");
    expect(html).toContain('value="What is your name?"');
  });

  it("uses a textarea in multiline mode", () => {
    const html = renderToStaticMarkup(
      h(InlineEditable, {
        value: "Paragraph",
        editing: true,
        multiline: true,
        onBegin: () => {},
        onCommit: () => {},
        onCancel: () => {},
        ariaLabel: "Edit text",
      }),
    );
    expect(html).toContain("<textarea");
  });
});
