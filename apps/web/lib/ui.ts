// Canonical class constants for the FormForge design system ("Meridian",
// 2026 redesign #2): light-first editorial — warm paper canvas, ink
// typography, ultramarine primary, terracotta signal, crisp 1px rules.
// Builder agents: import from here instead of hand-writing
// class strings so markup stays consistent and refactor-safe.
//
// The CSS recipes behind these constants live in apps/web/app/globals.css
// (sections BUTTONS, PANELS/BADGES/CHIPS/SEG, STATE). Every value is a plain
// string, so they compose with template literals and Tailwind utilities:
//   className={`${BTN_SECONDARY} w-full`}
//
// Meridian vocabulary (consume tokens from globals.css, never hardcode):
//   --ff-primary   ultramarine action color — one primary action per view
//   --ff-accent    terracotta signal — badges, highlights, active states
//   --ff-grad      ultramarine→deep ultramarine, used sparingly (progress,
//                  selected states)
//   --ff-glow      restrained ultramarine shadow — primary CTA hover only
//   --ff-glass     near-opaque chrome surface (+ --ff-glass-border) for
//                  sticky top bars
//   Text on primary surfaces is always --ff-primary-fg (#fff).

/* ---------- buttons ---------- */

export const BTN = "ff-btn";
export const BTN_PRIMARY = "ff-btn ff-btn-primary";
export const BTN_SECONDARY = "ff-btn ff-btn-secondary";
export const BTN_GHOST = "ff-btn ff-btn-ghost";
export const BTN_DESTRUCTIVE = "ff-btn ff-btn-destructive";

export const BTN_PRIMARY_SM = "ff-btn ff-btn-primary ff-btn-sm";
export const BTN_SECONDARY_SM = "ff-btn ff-btn-secondary ff-btn-sm";
export const BTN_GHOST_SM = "ff-btn ff-btn-ghost ff-btn-sm";
export const BTN_DESTRUCTIVE_SM = "ff-btn ff-btn-destructive ff-btn-sm";

export const BTN_PRIMARY_LG = "ff-btn ff-btn-primary ff-btn-lg";

/* ---------- surfaces ---------- */

/** The canonical card: white panel on paper, 1px hairline, soft paper shadow. */
export const CARD = "ff-panel";

/** Standalone input styling (same look as a .ff-field control). */
export const INPUT = "ff-input";

/** 2rem square ghost-style button for icon actions. */
export const ICON_BTN = "ff-icon-btn";

/* ---------- badges ---------- */

export const BADGE = "ff-badge";
export const BADGE_ACCENT = "ff-badge ff-badge--accent";
export const BADGE_POSITIVE = "ff-badge ff-badge--positive";
export const BADGE_WARNING = "ff-badge ff-badge--warning";
export const BADGE_MUTED = "ff-badge ff-badge--muted";
export const BADGE_DANGER = "ff-badge ff-badge--danger";

/* ---------- banners ---------- */

export const BANNER = "ff-banner";
export const BANNER_ERROR = "ff-banner ff-banner-error";
export const BANNER_SUCCESS = "ff-banner ff-banner-success";
export const BANNER_WARNING = "ff-banner ff-banner-warning";
export const BANNER_INFO = "ff-banner ff-banner-info";

/* ---------- segmented control ----------
 * <div className={SEG} role="group">
 *   <button type="button" className={SEG_BTN} aria-pressed={active}>…</button>
 * </div>
 */
export const SEG = "ff-seg";
export const SEG_BTN = "ff-seg-btn";
