// Curated theme presets (builder spec §23) — the exact table, verbatim.
//
// §23 claims every text/background AND primaryText/primary pair meets WCAG AA
// (>= 4.5:1). Measured with lib/builder/contrast.ts, TWO pairs violate the
// claim (see theme-presets.test.ts "SPEC-DEVIATION" before "fixing" anything):
//   - paper:  #FFFFFF on #D97706 = 3.19:1
//   - sunset: #FFFFFF on #EA580C = 3.56:1
// The values below are the spec's, kept verbatim per the zero-silent-drift
// policy; the panel's contrast badges surface the low ratio to the author.

import type { Theme, ThemeTokenKey, ThemeRadius } from "../bridge";

export type ThemePreset = {
  id: string;
  name: string;
  tokens: Record<ThemeTokenKey, string>;
  fontHeading: string;
  fontBody: string;
  radius: ThemeRadius;
};

/** §23 font allowlist: System stack + 12 curated Google Fonts, in table order. */
export const FONT_ALLOWLIST = [
  "System UI",
  "Inter",
  "Plus Jakarta Sans",
  "DM Sans",
  "Work Sans",
  "Outfit",
  "Space Grotesk",
  "Lora",
  "Merriweather",
  "Fraunces",
  "Playfair Display",
  "JetBrains Mono",
  "Fira Code",
] as const;

export type FontName = (typeof FONT_ALLOWLIST)[number];

/**
 * The 8 curated presets — §23 table, EXACT ids/names/hex/fonts/radius.
 * Order defines the panel's preset grid order.
 */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "default",
    name: "Default Light",
    tokens: {
      "color.bg": "#FFFFFF",
      "color.fg": "#111827",
      "color.primary": "#2563EB",
      "color.primaryFg": "#FFFFFF",
      "color.muted": "#6B7280",
      "color.border": "#E5E7EB",
    },
    fontHeading: "Inter",
    fontBody: "Inter",
    radius: "md",
  },
  {
    id: "paper",
    name: "Warm Paper",
    tokens: {
      "color.bg": "#FAF8F5",
      "color.fg": "#1C1917",
      "color.primary": "#D97706",
      "color.primaryFg": "#FFFFFF",
      "color.muted": "#78716C",
      "color.border": "#E7E5E4",
    },
    fontHeading: "Fraunces",
    fontBody: "Plus Jakarta Sans",
    radius: "sm",
  },
  {
    id: "slate-dark",
    name: "Slate Dark",
    tokens: {
      "color.bg": "#0F172A",
      "color.fg": "#F8FAFC",
      "color.primary": "#38BDF8",
      "color.primaryFg": "#0F172A",
      "color.muted": "#94A3B8",
      "color.border": "#1E293B",
    },
    fontHeading: "Space Grotesk",
    fontBody: "Inter",
    radius: "md",
  },
  {
    id: "forest",
    name: "Forest",
    tokens: {
      "color.bg": "#F4F7F4",
      "color.fg": "#14261C",
      "color.primary": "#15803D",
      "color.primaryFg": "#FFFFFF",
      "color.muted": "#52665A",
      "color.border": "#D1DDD6",
    },
    fontHeading: "Lora",
    fontBody: "Work Sans",
    radius: "lg",
  },
  {
    id: "cobalt",
    name: "Cobalt",
    tokens: {
      "color.bg": "#EFF6FF",
      "color.fg": "#1E3A8A",
      "color.primary": "#1D4ED8",
      "color.primaryFg": "#FFFFFF",
      "color.muted": "#64748B",
      "color.border": "#BFDBFE",
    },
    fontHeading: "Plus Jakarta Sans",
    fontBody: "Inter",
    radius: "md",
  },
  {
    id: "sunset",
    name: "Sunset",
    tokens: {
      "color.bg": "#FFF7ED",
      "color.fg": "#431407",
      "color.primary": "#EA580C",
      "color.primaryFg": "#FFFFFF",
      "color.muted": "#9A3412",
      "color.border": "#FED7AA",
    },
    fontHeading: "Outfit",
    fontBody: "DM Sans",
    radius: "full",
  },
  {
    id: "mono",
    name: "Monochrome",
    tokens: {
      "color.bg": "#FFFFFF",
      "color.fg": "#000000",
      "color.primary": "#000000",
      "color.primaryFg": "#FFFFFF",
      "color.muted": "#525252",
      "color.border": "#D4D4D4",
    },
    fontHeading: "JetBrains Mono",
    fontBody: "Inter",
    radius: "none",
  },
  {
    id: "hi-contrast",
    name: "High Contrast",
    tokens: {
      "color.bg": "#000000",
      "color.fg": "#FFFFFF",
      "color.primary": "#FACC15",
      "color.primaryFg": "#000000",
      "color.muted": "#D4D4D8",
      "color.border": "#FFFFFF",
    },
    fontHeading: "System UI",
    fontBody: "System UI",
    radius: "sm",
  },
];

/** The `default` row — what "Reset theme" (§8.2) restores. */
export function defaultPreset(): ThemePreset {
  const preset = THEME_PRESETS.find((p) => p.id === "default");
  if (!preset) throw new Error("theme-presets: the 'default' preset row is missing");
  return preset;
}

const TOKEN_KEYS: readonly ThemeTokenKey[] = [
  "color.bg",
  "color.fg",
  "color.primary",
  "color.primaryFg",
  "color.muted",
  "color.border",
];

const sameHex = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which preset a theme currently equals (case-insensitive hex), or null when
 * customized / defaulted-but-unmatched. Drives the panel's aria-pressed state.
 */
export function matchPreset(theme: Theme): string | null {
  for (const preset of THEME_PRESETS) {
    if (theme.fontHeading !== preset.fontHeading) continue;
    if (theme.fontBody !== preset.fontBody) continue;
    if (theme.radius !== preset.radius) continue;
    const tokensAllMatch = TOKEN_KEYS.every((key) => {
      const value = theme.tokens[key];
      return typeof value === "string" && sameHex(value, preset.tokens[key]);
    });
    if (tokensAllMatch) return preset.id;
  }
  return null;
}
