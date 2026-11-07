// B6-part-1 — ThemePanel tests (§8.2 + §23): static-render smokes over the
// preset grid (8 §23 names, aria-pressed active match), font allowlist
// options, radius segmented control, color rows + live contrast badges, plus
// unit tests for the pure validation/badge helpers.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentEnvelope, Theme } from "@/lib/bridge";
import { emptyBody } from "@/lib/builder/ops";
import { THEME_PRESETS } from "@/lib/builder/theme-presets";
import { editorReducer, initialEditorState, type EditorState } from "@/lib/builder/store";
import { BuilderProvider } from "./context";
import { TOKEN_ROWS, ThemePanel, contrastBadgeInfo, hexInputError } from "./ThemePanel";

const presetTheme = (id: string): Theme => {
  const preset = THEME_PRESETS.find((p) => p.id === id)!;
  return {
    tokens: { ...preset.tokens },
    fontHeading: preset.fontHeading,
    fontBody: preset.fontBody,
    radius: preset.radius,
  };
};

function envelopeWithTheme(theme: Theme): DocumentEnvelope {
  return {
    id: "doc1",
    rev: 1,
    title: "T",
    status: "draft",
    type: "form",
    body: { ...emptyBody("form"), theme },
  };
}

function renderPanel(envelope: DocumentEnvelope): string {
  const state: EditorState = editorReducer(initialEditorState("doc1"), {
    type: "loaded",
    envelope,
    mode: "mock",
  });
  return renderToStaticMarkup(
    h(BuilderProvider, { docId: state.docId, initialState: state, children: h(ThemePanel) }),
  );
}

describe("<ThemePanel> (static render)", () => {
  it("renders all 8 §23 preset names", () => {
    const html = renderPanel(envelopeWithTheme(emptyBody("form").theme));
    for (const preset of THEME_PRESETS) {
      expect(html).toContain(preset.name);
    }
    expect(html).toContain("Reset theme");
  });

  it("marks the matching preset aria-pressed and the others not", () => {
    const html = renderPanel(envelopeWithTheme(presetTheme("mono")));
    const presetButtons = html.match(/<button[^>]*data-preset-id="[^"]*"[^>]*>/g) ?? [];
    expect(presetButtons).toHaveLength(THEME_PRESETS.length);
    const monoBtn = presetButtons.find((b) => b.includes('data-preset-id="mono"')) ?? "";
    expect(monoBtn).toContain('aria-pressed="true"');
    expect(presetButtons.filter((b) => b.includes('aria-pressed="true"'))).toHaveLength(1);
  });

  it("no preset matches the workspace-default theme (all unpressed)", () => {
    const html = renderPanel(envelopeWithTheme(emptyBody("form").theme));
    const presetButtons = html.match(/<button[^>]*data-preset-id="[^"]*"[^>]*>/g) ?? [];
    expect(presetButtons.filter((b) => b.includes('aria-pressed="true"'))).toHaveLength(0);
  });

  it("font selects offer the §23 allowlist (includes Inter and Playfair Display)", () => {
    const html = renderPanel(envelopeWithTheme(emptyBody("form").theme));
    for (const font of ["Inter", "Playfair Display", "JetBrains Mono", "Fira Code", "System UI"]) {
      expect(html).toContain(`value="${font}"`);
    }
  });

  it("renders the five radius options with the current one pressed", () => {
    const html = renderPanel(envelopeWithTheme(emptyBody("form").theme));
    for (const radius of ["none", "sm", "md", "lg", "full"]) {
      expect(html).toContain(`>${radius}</button>`);
    }
    expect(html).toMatch(/>md<\/button>/);
  });

  it("renders the six color rows with labels", () => {
    const html = renderPanel(envelopeWithTheme(emptyBody("form").theme));
    for (const row of TOKEN_ROWS) {
      expect(html).toContain(row.label);
    }
    expect(html).toContain('data-token="color.bg"');
    expect(html).toContain('data-token="color.primaryFg"');
  });

  it("shows passing contrast badges for the default token pair", () => {
    const html = renderPanel(envelopeWithTheme(emptyBody("form").theme));
    // fg #0f172a on bg #ffffff = 17.86:1 → badge 17.9:1 AA ✓, no warning.
    expect(html).toContain('data-testid="contrast-badge-color.fg"');
    expect(html).toContain("17.9:1 AA ✓");
    expect(html).not.toContain("below 4.5");
  });

  it("shows a warning badge (not a block) for a low-contrast pair", () => {
    const theme: Theme = {
      ...emptyBody("form").theme,
      tokens: {
        ...emptyBody("form").theme.tokens,
        "color.fg": "#777777", // 4.48:1 on white
      },
    };
    const html = renderPanel(envelopeWithTheme(theme));
    expect(html).toContain("4.5:1 — below 4.5");
  });

  it("drops the text badge while its hex value is unparseable", () => {
    const theme: Theme = { ...emptyBody("form").theme, tokens: { ...emptyBody("form").theme.tokens, "color.fg": "banana" } };
    const html = renderPanel(envelopeWithTheme(theme));
    expect(html).not.toContain('data-testid="contrast-badge-color.fg"');
    // The primary pair is still fine — its badge stays.
    expect(html).toContain('data-testid="contrast-badge-color.primaryFg"');
  });
});

describe("hexInputError (unit)", () => {
  it("accepts empty (no draft), #rgb and #rrggbb", () => {
    expect(hexInputError("")).toBeNull();
    expect(hexInputError("#fff")).toBeNull();
    expect(hexInputError("#AABBCC")).toBeNull();
  });

  it("rejects malformed values with the inline message", () => {
    expect(hexInputError("AABBCC")).toBe("Use #rgb or #rrggbb");
    expect(hexInputError("#12345")).toBe("Use #rgb or #rrggbb");
    expect(hexInputError("#zzzzzz")).toBe("Use #rgb or #rrggbb");
  });
});

describe("contrastBadgeInfo (unit)", () => {
  it("returns pass info for a good pair", () => {
    expect(contrastBadgeInfo("#000000", "#ffffff")).toEqual({ label: "21.0:1 AA ✓", pass: true });
  });

  it("returns warn info below 4.5", () => {
    const info = contrastBadgeInfo("#777777", "#ffffff");
    expect(info?.pass).toBe(false);
    expect(info?.label).toBe("4.5:1 — below 4.5");
  });

  it("returns null for missing/invalid inputs (badge hidden)", () => {
    expect(contrastBadgeInfo(undefined, "#ffffff")).toBeNull();
    expect(contrastBadgeInfo("nope", "#ffffff")).toBeNull();
  });
});
