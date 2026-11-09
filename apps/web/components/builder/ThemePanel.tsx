'use client';

// Theme panel (builder spec §8.2 + §23).
//
// Presets grid (8 curated §23 themes) → one-click applies ONE `theme.update`
// op carrying the FULL patch {tokens: all 6, fontHeading, fontBody, radius};
// fine-tuning below: per-token color rows (picker + validated hex text input,
// 300 ms debounced with coalesce key `theme:<tokenKey>`), live WCAG contrast
// badges on the two §8.2 pairs (warning only — never blocks), heading/body
// font selects from the §23 allowlist, and a segmented radius control.
// "Reset theme" restores the `default` §23 row.
//
// The canvas live-updates automatically: it reads state.body.theme through
// the same store, so this panel only dispatches ops. No props; must render
// inside <BuilderProvider>.

import { useCallback, useEffect, useState } from "react";
import type { ThemeRadius } from "../../lib/bridge";
import type { ThemeTokenKey } from "../../lib/bridge";
import { contrastRatio, isHexColor, normalizeHex, passesAA, wcagLabel } from "../../lib/builder/contrast";
import type { ThemePatch } from "../../lib/builder/ops";
import { BADGE_POSITIVE, BADGE_WARNING, BTN_SECONDARY_SM, SEG, SEG_BTN } from "../../lib/ui";
import {
  FONT_ALLOWLIST,
  THEME_PRESETS,
  defaultPreset,
  matchPreset,
  type ThemePreset,
} from "../../lib/builder/theme-presets";
import { useBuilder } from "./context";

/** Hex text-input debounce (§3.3-style coalescing; picker applies instantly). */
export const THEME_HEX_DEBOUNCE_MS = 300;

/** The six §8.2 color rows in display order. */
export const TOKEN_ROWS: ReadonlyArray<{ key: ThemeTokenKey; label: string }> = [
  { key: "color.bg", label: "Background" },
  { key: "color.fg", label: "Text" },
  { key: "color.primary", label: "Primary" },
  { key: "color.primaryFg", label: "Primary text" },
  { key: "color.muted", label: "Muted" },
  { key: "color.border", label: "Border" },
];

const RADII: readonly ThemeRadius[] = ["none", "sm", "md", "lg", "full"];

/** Radius token → px for the mini previews (visual only). */
export const RADIUS_PX: Record<ThemeRadius, number> = { none: 0, sm: 6, md: 10, lg: 16, full: 999 };

/** Inline validation message for a hex text input (null = fine/empty). */
export function hexInputError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null; // empty = "no draft", committed value shows
  return isHexColor(trimmed) ? null : "Use #rgb or #rrggbb";
}

export type ContrastBadgeInfo = { label: string; pass: boolean };

/** Badge info for a fg/bg pair, or null while either hex is unparseable. */
export function contrastBadgeInfo(fg: string | undefined, bg: string | undefined): ContrastBadgeInfo | null {
  if (typeof fg !== "string" || typeof bg !== "string") return null;
  try {
    const ratio = contrastRatio(fg, bg);
    return { label: wcagLabel(ratio), pass: passesAA(ratio) };
  } catch {
    return null;
  }
}

export function ThemePanel() {
  const { state, dispatch } = useBuilder();
  const theme = state.body.theme;

  // Draft hex text per token key — committed value wins once it catches up.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const applyPatch = useCallback(
    (patch: ThemePatch, label: string) => {
      dispatch({ type: "apply", ops: [{ op: "theme.update", patch }], label });
    },
    [dispatch],
  );

  const applyToken = useCallback(
    (key: ThemeTokenKey, raw: string) => {
      const hex = normalizeHex(raw);
      if (!hex) return;
      dispatch({
        type: "apply",
        ops: [{ op: "theme.update", patch: { tokens: { [key]: hex } } }],
        label: `Set ${TOKEN_ROWS.find((r) => r.key === key)?.label ?? key}`,
        coalesce: { key: `theme:${key}`, at: Date.now() },
      });
    },
    [dispatch],
  );

  const applyPreset = useCallback(
    (preset: ThemePreset, label: string) => {
      dispatch({
        type: "apply",
        ops: [
          {
            op: "theme.update",
            patch: {
              tokens: { ...preset.tokens },
              fontHeading: preset.fontHeading,
              fontBody: preset.fontBody,
              radius: preset.radius,
            },
          },
        ],
        label,
      });
      setDrafts({});
    },
    [dispatch],
  );

  // Drop drafts the committed theme has caught up with (picker click, undo,
  // preset apply) so the text inputs re-sync with the store.
  useEffect(() => {
    setDrafts((prev) => {
      let dropped = false;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const committed = theme.tokens[key] ?? "";
        if (normalizeHex(value)?.toLowerCase() === committed.toLowerCase()) dropped = true;
        else next[key] = value;
      }
      return dropped ? next : prev;
    });
  }, [theme]);

  // Debounced apply for valid draft hex (300 ms), coalesced per token key.
  useEffect(() => {
    const pending = Object.entries(drafts).filter(([key, value]) => {
      const committed = theme.tokens[key] ?? "";
      return isHexColor(value) && normalizeHex(value)?.toLowerCase() !== committed.toLowerCase();
    });
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      for (const [key, value] of pending) applyToken(key as ThemeTokenKey, value);
      setDrafts({});
    }, THEME_HEX_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [drafts, theme, applyToken]);

  const activePresetId = matchPreset(theme);
  const setDraft = (key: string, value: string) => setDrafts((prev) => ({ ...prev, [key]: value }));

  // §8.2 badge pairs: Text-on-Background and Primary-on-Primary-text.
  const textBadge = contrastBadgeInfo(theme.tokens["color.fg"], theme.tokens["color.bg"]);
  const primaryBadge = contrastBadgeInfo(theme.tokens["color.primaryFg"], theme.tokens["color.primary"]);

  return (
    <div className="flex flex-col gap-4 p-3" data-testid="theme-panel">
      {/* --- Presets (§23) -------------------------------------------------- */}
      <section aria-label="Presets" className="flex flex-col gap-2 border-b border-[color:var(--ff-border)] pb-4">
        <h3 className="sticky top-0 z-10 m-0 bg-[color:var(--ff-card)] pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ff-muted)]">
          Presets
        </h3>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Theme presets">
          {THEME_PRESETS.map((preset) => {
            const active = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className="flex flex-col items-stretch gap-1.5 rounded-lg border border-[color:var(--ff-border)] p-1.5 text-left transition-colors duration-150 ease-[var(--ff-ease-out)] hover:bg-[color:var(--ff-bg-2)] disabled:cursor-not-allowed"
                aria-pressed={active}
                data-preset-id={preset.id}
                title={`Apply theme: ${preset.name}`}
                style={active ? { outline: "2px solid var(--ff-primary)", outlineOffset: "2px" } : undefined}
                onClick={() => applyPreset(preset, `Apply theme: ${preset.name}`)}
              >
                <span
                  aria-hidden="true"
                  className="flex min-h-10 items-center justify-between px-2 py-1 text-xs font-semibold"
                  style={{
                    background: preset.tokens["color.bg"],
                    color: preset.tokens["color.fg"],
                    borderRadius: RADIUS_PX[preset.radius],
                    border: `1px solid ${preset.tokens["color.border"]}`,
                  }}
                >
                  <span>Aa</span>
                  <span
                    className="px-2 py-0.5 text-[10px]"
                    style={{
                      background: preset.tokens["color.primary"],
                      color: preset.tokens["color.primaryFg"],
                      borderRadius: RADIUS_PX[preset.radius],
                    }}
                  >
                    Aa
                  </span>
                </span>
                <span className="text-xs text-[color:var(--ff-fg)]">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* --- Colors (§8.2: picker + hex + contrast badges) ------------------- */}
      <section aria-label="Colors" className="flex flex-col gap-2 border-b border-[color:var(--ff-border)] pb-4">
        <h3 className="sticky top-0 z-10 m-0 bg-[color:var(--ff-card)] pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ff-muted)]">
          Colors
        </h3>
        <div className="flex flex-col gap-1.5">
          {TOKEN_ROWS.map(({ key, label }) => {
            const committed = theme.tokens[key] ?? "";
            const value = drafts[key] ?? committed;
            const error = hexInputError(value);
            const badge = key === "color.fg" ? textBadge : key === "color.primaryFg" ? primaryBadge : null;
            return (
              <div key={key} className="flex min-h-9 items-center gap-2" data-token={key}>
                <label className="w-[5.5rem] shrink-0 text-[13px] font-medium text-[color:var(--ff-fg)]" htmlFor={`ff-th-color-${key}`}>
                  {label}
                </label>
                <input
                  id={`ff-th-color-${key}`}
                  type="color"
                  className="h-7 w-7 shrink-0 cursor-pointer rounded-lg border border-[color:var(--ff-border)] bg-transparent p-0"
                  aria-label={`${label} color picker`}
                  value={normalizeHex(committed) ?? "#000000"}
                  onChange={(e) => {
                    setDraft(key, e.target.value);
                    applyToken(key, e.target.value);
                  }}
                />
                <input
                  type="text"
                  className="w-24 rounded-lg border border-[color:var(--ff-border-strong)] bg-[color:color-mix(in_srgb,var(--ff-bg)_36%,var(--ff-card))] px-2 py-1 text-xs text-[color:var(--ff-fg)] outline-none transition-colors duration-150 focus-visible:border-[color:var(--ff-primary)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ff-primary)_22%,transparent)] disabled:opacity-50"
                  style={{ fontFamily: "var(--ff-font-mono)" }}
                  aria-label={`${label} hex value`}
                  value={value}
                  placeholder={committed || "#000000"}
                  spellCheck={false}
                  onChange={(e) => setDraft(key, e.target.value)}
                />
                {badge !== null && (
                  <span
                    className={badge.pass ? BADGE_POSITIVE : BADGE_WARNING}
                    data-testid={`contrast-badge-${key}`}
                  >
                    {badge.label}
                  </span>
                )}
                {error !== null && (
                  <span className="text-xs text-[color:var(--ff-danger)]" role="alert">
                    {error}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* --- Fonts (§23 allowlist) ------------------------------------------- */}
      <section aria-label="Fonts" className="flex flex-col gap-2 border-b border-[color:var(--ff-border)] pb-4">
        <h3 className="sticky top-0 z-10 m-0 bg-[color:var(--ff-card)] pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ff-muted)]">
          Fonts
        </h3>
        <div className="flex flex-col gap-1.5">
          <div className="flex min-h-9 items-center gap-2">
            <span className="w-[5.5rem] shrink-0 text-[13px] font-medium text-[color:var(--ff-fg)]">Heading</span>
            <select
              className="ff-input min-w-0 flex-1"
              aria-label="Heading font"
              value={theme.fontHeading}
              onChange={(e) => applyPatch({ fontHeading: e.target.value }, `Set heading font: ${e.target.value}`)}
            >
              {!FONT_ALLOWLIST.includes(theme.fontHeading as (typeof FONT_ALLOWLIST)[number]) && (
                <option value={theme.fontHeading}>{theme.fontHeading} (current)</option>
              )}
              {FONT_ALLOWLIST.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-h-9 items-center gap-2">
            <span className="w-[5.5rem] shrink-0 text-[13px] font-medium text-[color:var(--ff-fg)]">Body</span>
            <select
              className="ff-input min-w-0 flex-1"
              aria-label="Body font"
              value={theme.fontBody}
              onChange={(e) => applyPatch({ fontBody: e.target.value }, `Set body font: ${e.target.value}`)}
            >
              {!FONT_ALLOWLIST.includes(theme.fontBody as (typeof FONT_ALLOWLIST)[number]) && (
                <option value={theme.fontBody}>{theme.fontBody} (current)</option>
              )}
              {FONT_ALLOWLIST.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* --- Radius (§8.2 segmented control) ---------------------------------- */}
      <section aria-label="Corner radius" className="flex flex-col gap-2 border-b border-[color:var(--ff-border)] pb-4">
        <h3 className="sticky top-0 z-10 m-0 bg-[color:var(--ff-card)] pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ff-muted)]">
          Corner radius
        </h3>
        <div className={SEG} role="group" aria-label="Corner radius">
          {RADII.map((radius) => (
            <button
              key={radius}
              type="button"
              className={SEG_BTN}
              aria-pressed={theme.radius === radius}
              onClick={() => applyPatch({ radius }, `Set radius: ${radius}`)}
            >
              {radius}
            </button>
          ))}
        </div>
      </section>

      {/* --- Reset (§8.2: restore the preset) ---------------------------------- */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={BTN_SECONDARY_SM}
          data-testid="theme-reset"
          onClick={() => applyPreset(defaultPreset(), "Reset theme")}
        >
          Reset theme
        </button>
      </div>
    </div>
  );
}
