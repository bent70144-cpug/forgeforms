// PreviewModal.test.tsx — static chrome tests for the §8.4 preview modal
// (vitest node env, no jsdom). Follows builder-page.test.tsx: react-dom/server
// + the BuilderProvider `initialState` seam (effects never run in a static
// render, so focus capture/Tab-loop code paths are out of scope here).
//
// next/dynamic is stubbed to its loading fallback: a real dynamic import never
// resolves under renderToStaticMarkup. The heavy conversational renderer is
// exercised by the renderer package's own suite; this file pins the modal
// chrome contract (label, DRAFT chip, device toggle, prefill input, Restart,
// Close, Open live gating) without needing the renderer to mount.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DocumentEnvelope } from "@/lib/bridge";
import { emptyBody } from "@/lib/builder/ops";
import { editorReducer, initialEditorState } from "@/lib/builder/store";
import { BuilderProvider } from "./context";
import { PreviewModal } from "./PreviewModal";

vi.mock("next/dynamic", async () => {
  type LoadableOptions = { loading?: () => unknown };
  return {
    default: (loader: unknown, options?: LoadableOptions) => {
      void loader;
      function DynamicStub() {
        return options?.loading ? options.loading() : null;
      }
      return DynamicStub;
    },
  };
});

function envelope(overrides: Partial<DocumentEnvelope> = {}): DocumentEnvelope {
  return {
    id: "doc1",
    rev: 1,
    title: "Product feedback",
    slug: "product-feedback",
    status: "draft",
    type: "form",
    body: {
      ...emptyBody("form"),
      blocks: [{ id: "q1", kind: "short-text", props: { label: "Your name" } }],
      endings: [{ id: "end1", title: "Thanks!" }],
    },
    ...overrides,
  };
}

function renderModal(open: boolean, env: DocumentEnvelope): string {
  const state = editorReducer(initialEditorState("doc1"), {
    type: "loaded",
    envelope: env,
    mode: "mock",
  });
  return renderToStaticMarkup(
    h(BuilderProvider, {
      docId: "doc1",
      initialState: state,
      children: h(PreviewModal, { open, onClose: () => {} }),
    }),
  );
}

describe("PreviewModal — §8.4 chrome", () => {
  it("renders nothing when closed", () => {
    expect(renderModal(false, envelope())).toBe("");
  });

  it("renders the dialog with label, DRAFT chip and a11y attributes when open", () => {
    const html = renderModal(true, envelope());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Draft preview"');
    expect(html).toContain("Draft preview");
    expect(html).toContain("DRAFT");
  });

  it("renders the device toggle with Desktop pressed by default (aria-pressed)", () => {
    const html = renderModal(true, envelope());
    const desktop = html.indexOf('data-testid="preview-device-desktop"');
    const mobile = html.indexOf('data-testid="preview-device-mobile"');
    expect(html).toContain("Desktop");
    expect(html).toContain("Mobile");
    expect(desktop).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(-1);
    const pressed = html.indexOf('aria-pressed="true"');
    expect(pressed).toBeGreaterThan(-1);
    expect(pressed).toBeLessThan(desktop); // desktop starts pressed
  });

  it("renders the prefill params input, Restart and Close controls", () => {
    const html = renderModal(true, envelope());
    expect(html).toContain('aria-label="Prefill URL params"');
    expect(html).toContain("Apply");
    expect(html).toContain("Restart");
    expect(html).toContain("Close");
    expect(html).toContain('data-testid="preview-restart"');
    expect(html).toContain('data-testid="preview-close"');
  });

  it("renders the renderer loading surface (lazy dynamic import placeholder)", () => {
    const html = renderModal(true, envelope());
    expect(html).toContain("Loading preview");
    expect(html).toContain("ff-prev-frame-inner");
  });

  it("hides Open live for a draft document even when a slug exists", () => {
    const html = renderModal(true, envelope({ status: "draft", slug: "product-feedback" }));
    expect(html).not.toContain("Open live");
    expect(html).not.toContain('href="/p/product-feedback"');
  });

  it("shows the Open live link only when published with a slug", () => {
    const html = renderModal(true, envelope({ status: "published", slug: "product-feedback" }));
    expect(html).toContain("Open live");
    expect(html).toContain('href="/p/product-feedback"');
    expect(html).toContain('target="_blank"');
    // The preview itself is still the draft (§8.4), chip stays DRAFT.
    expect(html).toContain("DRAFT");
  });

  it("hides Open live when published without a slug", () => {
    const html = renderModal(true, envelope({ status: "published", slug: undefined }));
    expect(html).not.toContain("Open live");
  });
});
