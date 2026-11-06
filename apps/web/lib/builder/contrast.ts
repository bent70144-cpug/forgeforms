// WCAG 2.x contrast math for the theme panel (builder spec §8.2 + §23).
//
// Pure functions, no React/DOM — the ThemePanel renders live "4.7:1 AA ✓"
// badges from these, and theme-presets.test.ts audits the §23 preset table.
//
// Reference: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
// (the spec's §23 AA claim uses the 4.5:1 normal-text threshold).

export type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Parse `#rgb` / `#rrggbb` (leading `#` optional, case-insensitive).
 * Returns null for anything else — callers decide whether that is a hard
 * error (text input validation) or just "no badge yet".
 */
export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  let body = match[1] ?? "";
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = parseInt(body, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Canonical `#rrggbb` lowercase form (e.g. `#ABC` → `#aabbcc`). Invalid → null. */
export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (v: number) => v.toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** Panel-level validation: requires the leading `#` and 3 or 6 hex digits. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value.trim());
}

/** WCAG relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const linearize = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Contrast ratio between two hex colors, rounded to 2 decimals
 * (1 = identical, 21 = black on white). Throws on unparseable input —
 * the panel validates first and only calls this with known-good hex.
 */
export function contrastRatio(a: string, b: string): number {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) throw new TypeError(`contrastRatio: invalid hex ${JSON.stringify([a, b])}`);
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const ratio = (Math.max(lA, lB) + 0.05) / (Math.min(lA, lB) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** WCAG AA for normal text: ratio >= 4.5. */
export function passesAA(ratio: number): boolean {
  return ratio >= 4.5;
}

/**
 * Badge label for a ratio: "4.7:1 AA ✓" when it passes, otherwise the
 * non-blocking warning "3.2:1 — below 4.5" (§8.2: warn, never block).
 */
export function wcagLabel(ratio: number): string {
  const text = `${(Math.round(ratio * 10) / 10).toFixed(1)}:1`;
  return passesAA(ratio) ? `${text} AA ✓` : `${text} — below 4.5`;
}
