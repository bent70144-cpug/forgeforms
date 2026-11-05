// Theme → CSS variable mapping (spec §14.3 design tokens).
// The snapshot builder (T10) resolves a document theme into a CSS-variable map;
// this module normalizes whatever arrives into the canonical `--ff-*` set so the
// scroll renderer is resilient to token-name drift (e.g. "color.bg" vs "--ff-bg").

import type { CSSProperties } from "react";

export const FF_VAR_PREFIX = "--ff-";

/** Sane light defaults so an empty/missing theme still renders readably. */
export const DEFAULT_THEME_VARS: Record<string, string> = {
  "--ff-bg": "#fbf9f4",
  "--ff-fg": "#1c1917",
  "--ff-primary": "#1c1917",
  "--ff-primary-fg": "#fbf9f4",
  "--ff-muted": "#78716c",
  "--ff-border": "#e7e5e4",
  "--ff-radius": "0.5rem",
  "--ff-font-heading": '"Inter", sans-serif',
  "--ff-font-body": '"Inter", sans-serif',
};

/** Canonical tokens from spec §14.3, matched against lower-cased token names. */
const CANONICAL_VAR_ALIASES: Record<string, string> = {
  bg: "--ff-bg",
  background: "--ff-bg",
  "color.bg": "--ff-bg",
  "color.background": "--ff-bg",
  fg: "--ff-fg",
  foreground: "--ff-fg",
  text: "--ff-fg",
  "color.fg": "--ff-fg",
  "color.text": "--ff-fg",
  primary: "--ff-primary",
  "color.primary": "--ff-primary",
  primaryfg: "--ff-primary-fg",
  "color.primaryfg": "--ff-primary-fg",
  "color.primary-fg": "--ff-primary-fg",
  onprimary: "--ff-primary-fg",
  "color.onprimary": "--ff-primary-fg",
  muted: "--ff-muted",
  "color.muted": "--ff-muted",
  border: "--ff-border",
  "color.border": "--ff-border",
  radius: "--ff-radius",
  "radius.value": "--ff-radius",
  fontheading: "--ff-font-heading",
  "font.heading": "--ff-font-heading",
  "font-heading": "--ff-font-heading",
  fontbody: "--ff-font-body",
  "font.body": "--ff-font-body",
  "font-body": "--ff-font-body",
};

const RADIUS_KEYWORDS: Record<string, string> = {
  none: "0px",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "1rem",
  xl: "1.5rem",
  full: "9999px",
};

export type NormalizeCssVarsOptions = {
  /** Merge over DEFAULT_THEME_VARS (default true). */
  withDefaults?: boolean;
};

/**
 * Normalize a snapshot's cssVars into the canonical `--ff-*` variable map.
 * Accepts raw theme tokens ("color.bg"), already-prefixed vars ("--ff-bg") and
 * bare package-style keys ("ff-bg"); unknown custom tokens become "--ff-<slug>".
 */
export function normalizeCssVars(
  cssVars: Record<string, string> | undefined | null,
  options: NormalizeCssVarsOptions = {},
): Record<string, string> {
  const out: Record<string, string> =
    options.withDefaults === false ? {} : { ...DEFAULT_THEME_VARS };
  const input = cssVars ?? {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (typeof rawValue !== "string") continue;
    const value = rawValue.trim();
    if (!value) continue;
    const key = normalizeVarKey(rawKey);
    if (!key) continue;
    out[key] = normalizeVarValue(key, value);
  }
  return out;
}

function normalizeVarKey(rawKey: string): string | null {
  const key = rawKey.trim();
  if (!key) return null;
  if (key.startsWith("--")) return key;
  const stripped = key.replace(/^[-\s]+/, "");
  const lookup = stripped.toLowerCase().replace(/_/g, "");
  const alias = CANONICAL_VAR_ALIASES[lookup];
  if (alias) return alias;
  const slug = stripped
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!slug) return null;
  if (/^ff[-_.]/.test(slug)) return `--${slug}`;
  return `${FF_VAR_PREFIX}${slug}`;
}

function normalizeVarValue(varName: string, value: string): string {
  switch (varName) {
    case "--ff-radius":
      return normalizeRadiusValue(value);
    case "--ff-font-heading":
    case "--ff-font-body":
      return normalizeFontFamilyValue(value);
    default:
      return value;
  }
}

/**
 * Radius arrives either as a CSS length, a bare number, or the spec §7 enum
 * ("none" | "sm" | "md" | "lg" | "full" — plus "xl" defensively).
 */
export function normalizeRadiusValue(value: string): string {
  const v = value.trim().toLowerCase();
  const keyword = RADIUS_KEYWORDS[v];
  if (keyword) return keyword;
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`;
  return value.trim();
}

/** Wrap a bare font name in a safe stack; pass through stacks that are already quoted/composed. */
export function normalizeFontFamilyValue(value: string): string {
  const v = value.trim();
  if (!v) return '"Inter", sans-serif';
  if (/["']/.test(v) || v.includes(",")) return v;
  return `"${v}", sans-serif`;
}

/** Inline style carrying only custom CSS variables (for the themed wrapper element). */
export type CSSVarStyle = CSSProperties & Record<`--${string}`, string | number>;

export function cssVarsToStyle(vars: Record<string, string>): CSSVarStyle {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key.startsWith("--") && value) style[key] = value;
  }
  return style as CSSVarStyle;
}
