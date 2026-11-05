// rating input — scale 3–10 (spec §7.2), icon glyphs, digit shortcuts.
// Clicking/digits set the value; the parent auto-advances (<300ms, spec §10.2).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { QuestionInputCommon } from './shared';
import { digitFromKey, isTextEntryTarget, swallowEscape } from './shared';

export interface RatingInputProps extends QuestionInputCommon {
  /** spec §7.2: scale(3–10); default 5. */
  scale?: number;
  icon?: string;
}

const GLYPHS: Record<string, string> = {
  star: '★',
  heart: '♥',
  thumb: '👍',
  check: '✓',
};

function glyphFor(icon: string | undefined): string {
  if (!icon) return GLYPHS['star'] as string;
  return GLYPHS[icon] ?? icon;
}

export function RatingInput(props: RatingInputProps) {
  const { scale: rawScale, icon, value, error, onChange, onSubmit, labelId, describedByIds } = props;
  const scale = Math.min(
    10,
    Math.max(3, typeof rawScale === 'number' && Number.isFinite(rawScale) ? rawScale : 5),
  );
  const glyph = glyphFor(icon);
  const [highlighted, setHighlighted] = useState(-1);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const groupRef = useRef<HTMLDivElement | null>(null);

  // Initial focus on the group so ↑/↓ work immediately.
  useEffect(() => {
    groupRef.current?.focus();
  }, []);

  const selected = typeof value === 'number' ? value : undefined;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    swallowEscape(event);
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!mod && highlighted >= 1) onChange(highlighted);
      onSubmit();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(scale, (highlighted < 0 ? selected ?? 0 : highlighted) + 1);
      setHighlighted(next);
      buttonsRef.current[next - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      const prev = Math.max(1, (highlighted < 0 ? selected ?? scale + 1 : highlighted) - 1);
      setHighlighted(prev);
      buttonsRef.current[prev - 1]?.focus();
      return;
    }
    if (!isTextEntryTarget(event)) {
      const digit = digitFromKey(event.key);
      if (digit !== null && digit >= 1 && digit <= scale) {
        event.preventDefault();
        onChange(digit); // parent schedules auto-advance
      }
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={describedByIds}
      aria-invalid={error ? true : undefined}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            ref={(node) => {
              buttonsRef.current[n - 1] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected === n}
            aria-label={`${n} out of ${scale}`}
            tabIndex={-1}
            className="ff-option"
            style={{
              width: 56,
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 2,
              marginBottom: 0,
              fontSize: 22,
              color: selected !== undefined && n <= selected ? 'var(--ff-primary)' : undefined,
            }}
            onClick={() => onChange(n)}
          >
            <span aria-hidden="true">{glyph}</span>
            <span style={{ fontSize: 11, color: 'var(--ff-muted)' }}>{n}</span>
          </button>
        ))}
      </div>
      <p className="ff-hint" aria-hidden="true">
        Press <kbd>1</kbd>–<kbd>{scale}</kbd> to rate · <kbd>Enter</kbd> ↵ to continue
      </p>
    </div>
  );
}
