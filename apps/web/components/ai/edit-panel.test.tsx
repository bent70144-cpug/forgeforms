// B8 — static smoke for the extended edit panel (spec §11/§24): the gated
// proposal UI is interaction-driven, so server-render asserts the idle shell
// (instruction, propose action, diff-first promise). Apply/Discard behaviour
// lives behind fetch + state; the pure bridge is unit-tested in
// lib/builder/ai-apply.test.ts.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentBody } from "@formforge/core/ai";
import { AiEditPanel, newAiBatchId } from "./edit-panel";

const EMPTY_FORM: DocumentBody = {
  schemaVersion: 1,
  type: "form",
  theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
  settings: {
    seo: {},
    locale: "en",
    progressBar: true,
    autoAdvance: true,
    showBranding: true,
    captcha: false,
    notifyEmails: [],
  },
  blocks: [],
  endings: [],
  logic: { rules: [] },
};

describe("<AiEditPanel>", () => {
  it("renders the review-first shell: instruction, propose action, nothing applied yet", () => {
    const html = renderToStaticMarkup(
      h(AiEditPanel, { document: EMPTY_FORM, onApply: () => {} }),
    );
    expect(html).toContain("Edit with AI");
    expect(html).toContain("What should change?");
    expect(html).toContain("Propose changes");
    expect(html).toContain("Nothing changes until you apply them");
    // no proposal yet — no Apply/Discard buttons in the idle shell
    expect(html).not.toContain("Apply ops");
    expect(html).not.toContain("Discard");
  });
});

describe("newAiBatchId", () => {
  it("mints unique batch ids for the ai:<batchId> history group", () => {
    const a = newAiBatchId();
    const b = newAiBatchId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
