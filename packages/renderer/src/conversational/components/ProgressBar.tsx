// Determinate progress bar (spec §14 / issue #12). Pure presentational.
import type { CSSProperties } from 'react';

export interface ProgressBarProps {
  /** 0–100. */
  percent: number;
  visible: boolean;
}

export function ProgressBar({ percent, visible }: ProgressBarProps) {
  if (!visible) return null;
  const clamped = Math.max(0, Math.min(100, percent));
  const track: CSSProperties = {
    height: 4,
    width: '100%',
    background: 'color-mix(in srgb, var(--ff-fg) 12%, transparent)',
  };
  // Transition (and its reduced-motion override) lives in CONVERSATIONAL_STYLES
  // under .ff-progress-fill so prefers-reduced-motion can disable it.
  const fill: CSSProperties = {
    height: '100%',
    width: `${clamped}%`,
    background: 'var(--ff-primary)',
  };
  return (
    <div
      role="progressbar"
      aria-label="Form progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      style={track}
    >
      <div className="ff-progress-fill" style={fill} />
    </div>
  );
}
