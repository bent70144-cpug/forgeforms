// packages/blocks — safe section backgrounds.
// Mirrors the scroll renderer's `resolveBackground` (packages/renderer, T11) so
// registry-level rendering matches the snapshot path: theme token aliases,
// real CSS colors and var() references pass; arbitrary strings become null and
// the style attribute stays untouched (spec §17: no untrusted CSS injection).
// OWNED BY T21 (issue #21).

const BACKGROUND_ALIASES: Record<string, string> = {
  bg: "var(--ff-bg)",
  background: "var(--ff-bg)",
  fg: "var(--ff-fg)",
  primary: "var(--ff-primary)",
  "primary-fg": "var(--ff-primary-fg)",
  muted: "var(--ff-muted)",
  border: "var(--ff-border)",
};

/**
 * Resolve a stored background value to a safe CSS background, or null when it
 * should render as nothing ("", "none", unknown tokens, dangerous values).
 */
export function resolveSectionBackground(value: string | undefined | null): string | null {
  const v = (value ?? "").trim();
  if (v === "" || v.toLowerCase() === "none") return null;
  const lowered = v.toLowerCase().replace(/_/g, "-");
  const alias = BACKGROUND_ALIASES[lowered];
  if (alias) return alias;
  if (lowered === "color.bg") return "var(--ff-bg)";
  if (lowered === "color.fg" || lowered === "color.text") return "var(--ff-fg)";
  if (lowered === "color.primary") return "var(--ff-primary)";
  if (lowered === "color.muted") return "var(--ff-muted)";
  if (lowered === "color.border") return "var(--ff-border)";
  if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|lab\(|lch\(|color\(|var\(--[a-z0-9-]+\)|transparent|currentcolor)/i.test(v)) {
    return v;
  }
  return null;
}
