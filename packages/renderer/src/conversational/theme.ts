// Document theme → CSS variable map (spec §14.3 design tokens).
// The conversational renderer is self-contained (no Tailwind dependency at
// consumption time): it styles itself with inline styles + CSS variables so
// any host app picks it up without extra build config.
import type { CSSProperties } from 'react';
import type { Theme } from '../bridge';

export interface ThemeVars extends CSSProperties {
  '--ff-bg': string;
  '--ff-fg': string;
  '--ff-primary': string;
  '--ff-primary-fg': string;
  '--ff-muted': string;
  '--ff-border': string;
  '--ff-radius': string;
  '--ff-font-heading': string;
  '--ff-font-body': string;
}

const FALLBACKS = {
  bg: '#ffffff',
  fg: '#111827',
  primary: '#4f46e5',
  primaryFg: '#ffffff',
  muted: '#6b7280',
  border: '#e5e7eb',
  radius: '10px',
  fontHeading: "'Inter', system-ui, -apple-system, sans-serif",
  fontBody: "'Inter', system-ui, -apple-system, sans-serif",
};

const RADIUS_TO_PX: Record<string, string> = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '16px',
  full: '9999px',
};

function token(tokens: Record<string, string>, key: string): string | undefined {
  const value = tokens[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function themeToCssVars(theme: Theme | undefined): ThemeVars {
  const tokens = theme?.tokens ?? {};
  const radius =
    theme?.radius !== undefined ? (RADIUS_TO_PX[theme.radius] ?? FALLBACKS.radius) : FALLBACKS.radius;
  const fontStack = (font: string | undefined, fallback: string): string =>
    font && font.trim() !== '' ? `${font}, ${fallback}` : fallback;
  const systemStack = 'system-ui, -apple-system, sans-serif';

  return {
    '--ff-bg': token(tokens, 'color.bg') ?? FALLBACKS.bg,
    '--ff-fg': token(tokens, 'color.fg') ?? FALLBACKS.fg,
    '--ff-primary': token(tokens, 'color.primary') ?? FALLBACKS.primary,
    '--ff-primary-fg': token(tokens, 'color.primaryFg') ?? FALLBACKS.primaryFg,
    '--ff-muted': token(tokens, 'color.muted') ?? FALLBACKS.muted,
    '--ff-border': token(tokens, 'color.border') ?? FALLBACKS.border,
    '--ff-radius': radius,
    '--ff-font-heading': fontStack(theme?.fontHeading, systemStack),
    '--ff-font-body': fontStack(theme?.fontBody, systemStack),
  };
}
