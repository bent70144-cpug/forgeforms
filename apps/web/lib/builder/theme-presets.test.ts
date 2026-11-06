// §23 compliance tests: the 8 presets must match the spec table EXACTLY
// (ids, names, hex, fonts, radius), and every text/bg + primaryFg/primary
// pair is audited with the WCAG math from contrast.ts.
//
// SPEC-DEVIATION (report, do not "fix" here): §23 claims ALL pairs are AA
// (>= 4.5:1). Two primaryFg/primary pairs measured below 4.5:
//   - paper  #FFFFFF on #D97706 = 3.19:1
//   - sunset #FFFFFF on #EA580C = 3.56:1
// The spec values are kept verbatim (no silent spec edits). These two pairs
// are pinned at their exact measured ratios below so ANY change to the §23
// table fails loudly and must be a conscious, documented spec change.

import { describe, expect, it } from "vitest";
import type { Theme } from "../bridge";
import { contrastRatio, passesAA } from "./contrast";
import { FONT_ALLOWLIST, THEME_PRESETS as PRESETS, defaultPreset as dp, matchPreset as mp } from "./theme-presets";

const byId = new Map(PRESETS.map((p) => [p.id, p]));

describe("THEME_PRESETS (§23 table, exact)", () => {
  it("ships exactly the 8 spec ids in table order", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "default",
      "paper",
      "slate-dark",
      "forest",
      "cobalt",
      "sunset",
      "mono",
      "hi-contrast",
    ]);
  });

  it("matches the §23 names verbatim", () => {
    expect(PRESETS.map((p) => p.name)).toEqual([
      "Default Light",
      "Warm Paper",
      "Slate Dark",
      "Forest",
      "Cobalt",
      "Sunset",
      "Monochrome",
      "High Contrast",
    ]);
  });

  it("matches the §23 token hex values exactly", () => {
    const expected: Record<string, Record<string, string>> = {
      default: {
        "color.bg": "#FFFFFF",
        "color.fg": "#111827",
        "color.primary": "#2563EB",
        "color.primaryFg": "#FFFFFF",
        "color.muted": "#6B7280",
        "color.border": "#E5E7EB",
      },
      paper: {
        "color.bg": "#FAF8F5",
        "color.fg": "#1C1917",
        "color.primary": "#D97706",
        "color.primaryFg": "#FFFFFF",
        "color.muted": "#78716C",
        "color.border": "#E7E5E4",
      },
      "slate-dark": {
        "color.bg": "#0F172A",
        "color.fg": "#F8FAFC",
        "color.primary": "#38BDF8",
        "color.primaryFg": "#0F172A",
        "color.muted": "#94A3B8",
        "color.border": "#1E293B",
      },
      forest: {
        "color.bg": "#F4F7F4",
        "color.fg": "#14261C",
        "color.primary": "#15803D",
        "color.primaryFg": "#FFFFFF",
        "color.muted": "#52665A",
        "color.border": "#D1DDD6",
      },
      cobalt: {
        "color.bg": "#EFF6FF",
        "color.fg": "#1E3A8A",
        "color.primary": "#1D4ED8",
        "color.primaryFg": "#FFFFFF",
        "color.muted": "#64748B",
        "color.border": "#BFDBFE",
      },
      sunset: {
        "color.bg": "#FFF7ED",
        "color.fg": "#431407",
        "color.primary": "#EA580C",
        "color.primaryFg": "#FFFFFF",
        "color.muted": "#9A3412",
        "color.border": "#FED7AA",
      },
      mono: {
        "color.bg": "#FFFFFF",
        "color.fg": "#000000",
        "color.primary": "#000000",
        "color.primaryFg": "#FFFFFF",
        "color.muted": "#525252",
        "color.border": "#D4D4D4",
      },
      "hi-contrast": {
        "color.bg": "#000000",
        "color.fg": "#FFFFFF",
        "color.primary": "#FACC15",
        "color.primaryFg": "#000000",
        "color.muted": "#D4D4D8",
        "color.border": "#FFFFFF",
      },
    };
    for (const preset of PRESETS) {
      expect(preset.tokens, `preset ${preset.id}`).toEqual(expected[preset.id]);
    }
  });

  it("matches the §23 font pairs and radii", () => {
    expect(PRESETS.map((p) => [p.fontHeading, p.fontBody, p.radius])).toEqual([
      ["Inter", "Inter", "md"],
      ["Fraunces", "Plus Jakarta Sans", "sm"],
      ["Space Grotesk", "Inter", "md"],
      ["Lora", "Work Sans", "lg"],
      ["Plus Jakarta Sans", "Inter", "md"],
      ["Outfit", "DM Sans", "full"],
      ["JetBrains Mono", "Inter", "none"],
      ["System UI", "System UI", "sm"],
    ]);
  });

  it("every preset font is on the §23 allowlist", () => {
    const allow = new Set<string>(FONT_ALLOWLIST);
    for (const preset of PRESETS) {
      expect(allow.has(preset.fontHeading), `${preset.id} heading font`).toBe(true);
      expect(allow.has(preset.fontBody), `${preset.id} body font`).toBe(true);
    }
    // Allowlist itself: System + 12 curated Google Fonts (§23).
    expect(allow.size).toBe(13);
  });
});

describe("§23 AA audit (contrast.ts math)", () => {
  // Pairs the spec claims AA but measurably are NOT (see file header).
  const KNOWN_AA_VIOLATIONS: ReadonlySet<string> = new Set([
    "paper:primaryFg/primary",
    "sunset:primaryFg/primary",
  ]);

  const pairsOf = (presetId: string, tokens: Record<string, string>) => [
    { pair: "text/bg", fg: tokens["color.fg"] ?? "", bg: tokens["color.bg"] ?? "" },
    { pair: "primaryFg/primary", fg: tokens["color.primaryFg"] ?? "", bg: tokens["color.primary"] ?? "" },
  ].filter((p) => !KNOWN_AA_VIOLATIONS.has(`${presetId}:${p.pair}`));

  it("all other pairs pass WCAG AA (>= 4.5:1)", () => {
    for (const preset of PRESETS) {
      for (const { pair, fg, bg } of pairsOf(preset.id, preset.tokens)) {
        const ratio = contrastRatio(fg, bg);
        expect(passesAA(ratio), `${preset.id} ${pair} = ${ratio}:1`).toBe(true);
      }
    }
  });

  it("pins the two known violations at their exact measured ratios (3.19 / 3.56)", () => {
    const paper = byId.get("paper");
    const sunset = byId.get("sunset");
    expect(contrastRatio(paper?.tokens["color.primaryFg"] ?? "", paper?.tokens["color.primary"] ?? "")).toBe(3.19);
    expect(contrastRatio(sunset?.tokens["color.primaryFg"] ?? "", sunset?.tokens["color.primary"] ?? "")).toBe(3.56);
  });

  it("every preset pair is at least usable (> 3:1) so presets never ship broken", () => {
    for (const preset of PRESETS) {
      const textRatio = contrastRatio(preset.tokens["color.fg"] ?? "", preset.tokens["color.bg"] ?? "");
      const primaryRatio = contrastRatio(
        preset.tokens["color.primaryFg"] ?? "",
        preset.tokens["color.primary"] ?? "",
      );
      expect(textRatio).toBeGreaterThan(3);
      expect(primaryRatio).toBeGreaterThan(3);
    }
  });
});

describe("defaultPreset / matchPreset", () => {
  it("defaultPreset is the 'default' row (§8.2 reset target)", () => {
    expect(dp()).toBe(byId.get("default"));
    expect(dp().id).toBe("default");
  });

  it("matchPreset recognizes an exact preset theme", () => {
    const theme: Theme = {
      tokens: { ...byId.get("mono")!.tokens },
      fontHeading: "JetBrains Mono",
      fontBody: "Inter",
      radius: "none",
    };
    expect(mp(theme)).toBe("mono");
  });

  it("matchPreset is case-insensitive on hex", () => {
    const theme: Theme = {
      tokens: { "color.bg": "#ffffff", "color.fg": "#000000", "color.primary": "#000000", "color.primaryFg": "#ffffff", "color.muted": "#525252", "color.border": "#d4d4d4" },
      fontHeading: "JetBrains Mono",
      fontBody: "Inter",
      radius: "none",
    };
    expect(mp(theme)).toBe("mono");
  });

  it("matchPreset returns null for a customized theme", () => {
    const theme: Theme = {
      tokens: { ...byId.get("mono")!.tokens, "color.bg": "#fafafa" },
      fontHeading: "JetBrains Mono",
      fontBody: "Inter",
      radius: "none",
    };
    expect(mp(theme)).toBeNull();
    expect(mp({ tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" })).toBeNull();
  });
});
