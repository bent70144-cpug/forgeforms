// Wave-3b a11y sweep (task 9-a) — static-markup ARIA assertions for the
// builder surface (spec §12 acceptance items). Node-style assertions on
// renderToStaticMarkup output (effects never run — markup only), plus a
// jsdom-backed live test for the §6.2 move announcer (announce() event
// contract + <LiveAnnouncer /> polite region).
// @vitest-environment jsdom
import { act } from "react";
import { createElement as h, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentEnvelope } from "@/lib/bridge";
import { DEFAULT_THEME_TOKENS } from "@/lib/bridge";
import { initialEditorState, type EditorState } from "@/lib/builder/store";
import type { Block } from "@formforge/schema";
import type { CanvasActions } from "@/lib/builder/canvas-ops";
import { BuilderProvider } from "@/components/builder/context";
import { BlocksTree } from "@/components/builder/BlocksTree";
import { BlockToolbar } from "@/components/builder/BlockToolbar";
import { InlineEditable } from "@/components/builder/InlineEditable";
import { InsertionRow } from "@/components/builder/InsertionRow";
import { IssuesList } from "@/components/builder/IssuesList";
import { SettingsPanel } from "@/components/builder/SettingsPanel";
import { UndoToastView } from "@/components/builder/UndoToast";
import { LiveAnnouncer, announce } from "@/lib/builder/announce";
import { ISSUE_CODES, type ValidationIssue } from "@/lib/builder/publish";

// React 19: act() requires the test environment to opt in explicitly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures (same envelope shape as canvas.test.tsx)
// ---------------------------------------------------------------------------

function envelope(): DocumentEnvelope {
  return {
    id: "doc_a11y",
    rev: 3,
    title: "A11y sweep form",
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
      blocks: [
        { id: "q1", kind: "short-text", props: { label: "What is your name?", required: false } },
        { id: "sec1", kind: "section", props: { background: "none", padding: "md" }, children: [
          { id: "q2", kind: "long-text", props: { label: "أخبرنا المزيد", required: false } },
        ] },
      ],
      endings: [{ id: "end1", title: "Thanks!" }],
      logic: { rules: [] },
    },
  };
}

function seededState(sel: string | null = null): EditorState {
  const env = envelope();
  return {
    ...initialEditorState(env.id),
    ready: true,
    mode: "mock",
    meta: { title: env.title },
    body: env.body,
    docStatus: env.status,
    rev: env.rev,
    selection: sel,
  };
}

function renderWith(children: ReactNode, sel: string | null = null): string {
  function Harness() {
    const initial = useMemo(() => seededState(sel), [sel]);
    return h(BuilderProvider, { docId: "doc_a11y", initialState: initial, children });
  }
  return renderToStaticMarkup(h(Harness));
}

const block: Block = { id: "q1", kind: "short-text", props: { label: "Full name", required: false } };

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

const issue: ValidationIssue = {
  code: ISSUE_CODES.emptyLabel,
  message: "This short answer question has no label.",
  blockId: "q1",
  path: "blocks[0].props.label",
  level: "error",
};

// ---------------------------------------------------------------------------
// §12 landmarks + tree semantics
// ---------------------------------------------------------------------------

describe("a11y sweep — block tree (spec §12 ARIA tree)", () => {
  const html = renderWith(h(BlocksTree), "q1");

  it("renders role=tree labelled Blocks (canvas order == tree order)", () => {
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="Blocks"');
  });

  it("treeitems carry aria-selected, aria-level and aria-expanded", () => {
    // Selected row announces itself; others are explicitly not selected.
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain('aria-level="2"'); // the section's child
    expect(html).toContain('aria-expanded="true"'); // container row
  });

  it("exposes exactly ONE roving tab stop (selected row tabindex=0)", () => {
    expect(html).toContain('tabindex="0"');
    // Three rows: q1 (selected stop) + sec1 + its child q2 ride tabindex=-1.
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(2);
  });

  it("labels follow the text direction of their content (§14 dir=auto)", () => {
    expect(html).toContain('dir="auto"');
    expect(html).toContain("أخبرنا المزيد"); // RTL label rendered with dir=auto ancestor
  });
});

// ---------------------------------------------------------------------------
// §12 icon-only buttons + inert drag handle
// ---------------------------------------------------------------------------

describe("a11y sweep — icon-only buttons have aria-labels", () => {
  it("labels every BlockToolbar icon button", () => {
    const html = renderToStaticMarkup(
      h(BlockToolbar, { block, index: 0, siblingCount: 2, referencedByRules: false, actions: NOOP_ACTIONS }),
    );
    expect(html).toContain('aria-label="Move up"');
    expect(html).toContain('aria-label="Move down"');
    expect(html).toContain('aria-label="Duplicate question"');
    expect(html).toContain('aria-label="Delete block"');
    expect(html).toContain('aria-label="More actions"');
  });

  it("keeps the drag handle inert — not a focusable button that does nothing", () => {
    const html = renderToStaticMarkup(
      h(BlockToolbar, { block, index: 0, siblingCount: 2, referencedByRules: false, actions: NOOP_ACTIONS }),
    );
    // The handle glyph is inside an aria-hidden span, never a <button>.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>\s*⠿/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*⠿/);
    expect(html).not.toContain('aria-label="Drag');
  });

  it("labels the canvas insertion button and the issues drawer close/backdrop", () => {
    expect(renderToStaticMarkup(h(InsertionRow, { index: 0, parentId: null, actions: NOOP_ACTIONS })))
      .toContain('aria-label="Insert block here"');

    const issues = renderToStaticMarkup(
      h(IssuesList, { open: true, issues: [issue], onClose: () => {}, goTo: () => {} }),
    );
    expect(issues).toContain('aria-label="Close publish issues"');
    expect(issues).toContain('aria-live="polite"'); // count line is a live region
    expect(issues).toContain("1 blocking issue");
  });
});

// ---------------------------------------------------------------------------
// §12 live regions + §14 dir=auto on user-text containers
// ---------------------------------------------------------------------------

describe("a11y sweep — live regions and text direction", () => {
  it("undo toast is role=status aria-live=polite with labelled actions", () => {
    const html = renderToStaticMarkup(
      h(UndoToastView, { label: "Full name", hadLogic: true, onUndo: () => {}, onDismiss: () => {} }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Undo delete of Full name"');
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain("Used by logic rules"); // text, not color-only (§12)
  });

  it("inline-editable display span carries dir=auto (§14)", () => {
    const html = renderToStaticMarkup(
      h(InlineEditable, {
        value: "مرحبا — hello",
        editing: false,
        onBegin: () => {},
        onCommit: () => {},
        onCancel: () => {},
        ariaLabel: "Edit Short text text",
      }),
    );
    expect(html).toContain('data-testid="inline-editable"');
    expect(html).toContain('dir="auto"');
  });

  it("SEO social preview text carries dir=auto (§14)", () => {
    const html = renderWith(h(SettingsPanel, { initialTab: "seo" }));
    expect(html).toContain('data-testid="ff-set-social-preview"');
    expect(html).toContain('dir="auto"');
  });
});

// ---------------------------------------------------------------------------
// §6.2/§12 move announcer — event contract + polite region
// ---------------------------------------------------------------------------

describe("a11y sweep — LiveAnnouncer (ff:announce contract)", () => {
  it("static markup: one polite, visually hidden status region", () => {
    const html = renderToStaticMarkup(h(LiveAnnouncer));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="live-announcer"');
    expect(html).toContain("ff-a11y-announcer");
  });

  it("announce() dispatches {message} to any injected target and no-ops safely", () => {
    const captured: Event[] = [];
    const target = { dispatchEvent: (event: Event) => (captured.push(event), true) };
    announce("Full name moved to position 1 of 2", target);
    expect(captured).toHaveLength(1);
    const event = captured[0] as CustomEvent<{ message: string }>;
    expect(event.type).toBe("ff:announce");
    expect(event.detail.message).toBe("Full name moved to position 1 of 2");

    // Empty message → no event; missing target (SSR/node) → never throws.
    expect(() => announce("", target)).not.toThrow();
    expect(() => announce("ignored", null)).not.toThrow();
    expect(captured).toHaveLength(1);
  });

  it("mounted LiveAnnouncer announces moves politely through window events", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(h(LiveAnnouncer));
      });
      expect(container.querySelector('[data-testid="live-announcer"]')?.textContent).toBe("");

      act(() => {
        announce("Email address moved to position 2 of 2");
      });
      expect(container.querySelector('[data-testid="live-announcer"]')?.textContent).toBe(
        "Email address moved to position 2 of 2",
      );
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });
});
