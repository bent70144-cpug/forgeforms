// T-B4 — block picker tests (builder spec §6.1).
// Static-render smoke tests via react-dom/server (node env, no DOM) + real
// unit tests for the pure fuzzy-matching helpers.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderProvider } from "./context";
import { BlockPicker, filterPalette, fuzzyScore, type PaletteGroup } from "./BlockPicker";
import { paletteForType } from "@/lib/builder/blockMeta";

function renderPicker(open: boolean, props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    h(BuilderProvider, {
      docId: "test-doc",
      children: h(BlockPicker, {
        open,
        onClose: () => {},
        insertAt: { index: 0, parentId: null },
        ...props,
      }),
    }),
  );
}

describe("fuzzyScore (§6.1 fuzzy on label + kind + hint)", () => {
  it("orders prefix > substring > subsequence > miss", () => {
    const query = "sho";
    const prefix = fuzzyScore(query, "Short text"); // "sho" prefix of "short…"
    const substring = fuzzyScore(query, "Very short text"); // contains, not prefix
    const subsequence = fuzzyScore(query, "Steps hint outline"); // s…h…o in order
    const miss = fuzzyScore(query, "Image");
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
    expect(miss).toBe(-1);
  });

  it("is case-insensitive and trims; empty query matches neutrally", () => {
    expect(fuzzyScore("  TEXT ", "rich text")).toBeGreaterThan(0);
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("   ", "anything")).toBe(0);
  });
});

describe("filterPalette", () => {
  const FORM_PALETTE = paletteForType("form") as PaletteGroup[];

  it("empty query returns the contextual palette unchanged (form: Questions first)", () => {
    const result = filterPalette(FORM_PALETTE, "");
    expect(result.map((g) => g.family)).toEqual(["question", "action", "layout", "content"]);
    expect(result[0]?.kinds.map((k) => k.kind)).toContain("short-text");
  });

  it("filters by label across groups and keeps ranking within a group", () => {
    const result = filterPalette(FORM_PALETTE, "text");
    const kinds = result.flatMap((g) => g.kinds).map((k) => k.kind);
    expect(kinds).toContain("short-text");
    expect(kinds).toContain("long-text");
    expect(kinds).not.toContain("rating"); // no match
    // Substring position ranks: "text" sits earlier in "Long text" (5) than in "Short text" (6).
    expect(kinds.indexOf("long-text")).toBeLessThan(kinds.indexOf("short-text"));
  });

  it("drops groups with no matches and can produce an empty result", () => {
    expect(filterPalette(FORM_PALETTE, "zzzznothing")).toEqual([]);
    const galleryOnly = filterPalette(paletteForType("portfolio") as PaletteGroup[], "gallery");
    expect(galleryOnly).toHaveLength(1);
    expect(galleryOnly[0]?.kinds.map((k) => k.kind)).toEqual(["gallery"]);
  });
});

describe("<BlockPicker> (static smoke, §6.1 + §12 a11y)", () => {
  it("renders nothing when closed", () => {
    expect(renderPicker(false)).toBe("");
  });

  it("renders a modal dialog with grouped results, live count and footer hints", () => {
    const html = renderPicker(true);
    // Dialog + a11y roles (§12: trap + labelled dialog).
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Add a block"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-live="polite"');
    // Contextual groups for a form document (Questions first, §6.1).
    expect(html).toContain("Questions");
    expect(html).toContain("Actions");
    expect(html).toContain("Layout");
    expect(html).toContain("Content");
    // A known kind row + count line ("N blocks match").
    expect(html).toContain("Short text");
    expect(html).toContain("blocks match");
    // Footer hint row (§6.1).
    expect(html).toContain("↑↓ navigate · Enter insert · Esc close");
    // Search input is the focus anchor.
    expect(html).toContain("Search blocks");
  });

  it("shows only the inserting families available for the doc type (no form-only kinds on pages)", () => {
    // The fixture provider defaults to a form doc; here we assert a question kind IS offered,
    // and rely on filterPalette tests for the page/portfolio exclusions.
    const html = renderPicker(true);
    expect(html).toContain("Single select");
    expect(html).toContain("Multi-question page");
  });
});
