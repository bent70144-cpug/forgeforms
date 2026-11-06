// B6-part-1 — EndingsPanel tests (§8.3): static-render smokes for the
// endings list (rows + preview chips), the editor fields for the selected
// ending (including the schema-missing controls and the §8.3 redirect⇄body
// mutual exclusion, §24 Pro note, §8.3 last-ending guard), the live preview
// card, plus unit tests for the pure helpers (reference lookup, redirect
// validation, chips).

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentEnvelope } from "@/lib/bridge";
import { emptyBody } from "@/lib/builder/ops";
import { editorReducer, initialEditorState, type EditorState } from "@/lib/builder/store";
import { BuilderProvider } from "./context";
import {
  ENDING_EDIT_DEBOUNCE_MS,
  EndingsPanel,
  endingChip,
  newEnding,
  redirectError,
  rulesReferencingEnding,
} from "./EndingsPanel";

const ending1 = { id: "end1", title: "Thanks for reading!", body: "You did it." };
const ending2 = { id: "end2", title: "Off you go", redirectUrl: "https://example.com/done" };

const ruleToEnd1 = {
  id: "r1",
  scope: "q1",
  when: [],
  then: [{ type: "goto" as const, target: "end:end1" }],
  isFallback: false,
};

function envelopeWith(
  endings: Array<typeof ending1 | typeof ending2>,
  rules: Array<typeof ruleToEnd1> = [ruleToEnd1],
): DocumentEnvelope {
  return {
    id: "doc1",
    rev: 1,
    title: "T",
    status: "draft",
    type: "form",
    body: { ...emptyBody("form"), endings, logic: { rules } },
  };
}

function renderPanel(envelope: DocumentEnvelope): string {
  const state: EditorState = editorReducer(initialEditorState("doc1"), {
    type: "loaded",
    envelope,
    mode: "mock",
  });
  return renderToStaticMarkup(
    h(BuilderProvider, { docId: state.docId, initialState: state, children: h(EndingsPanel) }),
  );
}

describe("<EndingsPanel> (static render)", () => {
  it("renders list rows (title + preview chip) for every ending", () => {
    const html = renderPanel(envelopeWith([ending1, ending2]));
    expect(html).toContain("Thanks for reading!");
    expect(html).toContain("Off you go");
    expect(html).toContain("Body"); // chip for the body ending
    expect(html).toContain("Redirect"); // chip for the redirect ending
    expect(html).toContain('data-ending-id="end1"');
    expect(html).toContain('data-ending-id="end2"');
  });

  it("edits the FIRST ending by default: title value, body text, enabled body", () => {
    const html = renderPanel(envelopeWith([ending1, ending2]));
    expect(html).toContain('value="Thanks for reading!"');
    expect(html).toContain("You did it.");
    expect(html).not.toContain("Redirect endings show no body");
  });

  it("redirect-selected ending: body textarea disabled + §8.3 mutual-exclusion note", () => {
    const html = renderPanel(envelopeWith([ending2, ending1]));
    expect(html).toContain("Redirect endings show no body");
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toContain("https://example.com/done");
  });

  it("renders the schema-missing §8.3 controls disabled with the version note", () => {
    const html = renderPanel(envelopeWith([ending1]));
    expect(html).toContain("Not available in this version");
    expect((html.match(/Not available in this version/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/aria-label="Button label"[^>]*disabled/);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });

  it("keeps the redirect input ENABLED with the §24 Pro note (entitlement unknown)", () => {
    const html = renderPanel(envelopeWith([ending1]));
    expect(html).toContain("Redirect endings require Pro");
    expect(html).not.toMatch(/id="ff-ending-redirect"[^>]*disabled/);
  });

  it("delete is enabled with 2 endings and no confirm strip yet", () => {
    const html = renderPanel(envelopeWith([ending1, ending2]));
    const deleteBtn = html.match(/<button[^>]*data-testid="ending-delete"[^>]*>/)?.[0] ?? "";
    expect(deleteBtn).toContain('aria-disabled="false"');
    expect(html).not.toContain("Used by 1 rule");
    expect(html).not.toContain("A form needs at least one ending");
  });

  it("disables delete for the LAST ending with the §8.3 note", () => {
    const html = renderPanel(envelopeWith([ending1], []));
    expect(html).toMatch(/data-testid="ending-delete"[^>]*disabled/);
    expect(html).toContain("A form needs at least one ending");
  });

  it("renders the live preview card from the theme tokens", () => {
    const html = renderPanel(envelopeWith([ending1]));
    expect(html).toContain('data-testid="ending-preview"');
    expect(html).toContain("Thanks for reading!");
    expect(html).toContain("You did it.");
    expect(html).toContain("Continue");
  });

  it("offers Add ending", () => {
    const html = renderPanel(envelopeWith([ending1]));
    expect(html).toContain("Add ending");
    expect(html).toContain('data-testid="ending-add"');
  });

  it("renders an empty state when the document has no endings", () => {
    const html = renderPanel(envelopeWith([], []));
    expect(html).toContain("No endings yet");
  });
});

describe("rulesReferencingEnding (unit)", () => {
  it("counts rules whose goto target is end:<id> only", () => {
    const rules = [
      ruleToEnd1,
      { ...ruleToEnd1, id: "r2", then: [{ type: "goto" as const, target: "q2" }] },
      { ...ruleToEnd1, id: "r3", then: [{ type: "goto" as const, target: "end:end2" }] },
    ];
    expect(rulesReferencingEnding(rules, "end1")).toHaveLength(1);
    expect(rulesReferencingEnding(rules, "end2")).toHaveLength(1);
    expect(rulesReferencingEnding(rules, "endX")).toHaveLength(0);
  });
});

describe("redirectError (unit)", () => {
  it("accepts https URLs and empty (clearing)", () => {
    expect(redirectError("")).toBeNull();
    expect(redirectError("https://example.com/done")).toBeNull();
  });

  it("rejects http and non-URLs with the same inline message", () => {
    expect(redirectError("http://example.com")).toBe("Must be an https:// URL");
    expect(redirectError("not a url")).toBe("Must be an https:// URL");
  });
});

describe("endingChip / newEnding (unit)", () => {
  it("chips discriminate redirect / body / blank endings", () => {
    expect(endingChip(ending2)).toBe("Redirect");
    expect(endingChip(ending1)).toBe("Body");
    expect(endingChip({ id: "e3", title: "Blank" })).toBe("Blank");
  });

  it("newEnding is schema-valid: id + title, no stray fields", () => {
    const ending = newEnding(() => "fresh");
    expect(ending).toEqual({ id: "fresh", title: "Thank you!" });
  });

  it("exposes the 300 ms debounce constant", () => {
    expect(ENDING_EDIT_DEBOUNCE_MS).toBe(300);
  });
});
