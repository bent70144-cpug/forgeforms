"use client";

// NPS input — 0–10 (spec §7.2), left/right labels, 0–9 digit shortcuts and a
// two-key "1 then 0" buffer for 10. Auto-advance is driven by the parent.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { QuestionInputCommon } from './shared';
import { digitFromKey, isTextEntryTarget, swallowEscape } from './shared';

export interface NpsInputProps extends QuestionInputCommon {
  leftLabel?: string;
  rightLabel?: string;
}

const BUFFER_MS = 800; // window for the "1"→"0" two-key sequence producing 10

export function NpsInput(props: NpsInputProps) {
  const { leftLabel, rightLabel, value, error, onChange, onSubmit, labelId, describedByIds } = props;
  const [highlighted, setHighlighted] = useState(-1);
  const bufferRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const groupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    groupRef.current?.focus();
  }, []);

  const selected = typeof value === 'number' ? value : undefined;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    swallowEscape(event);
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!mod && highlighted >= 0) onChange(highlighted);
      onSubmit();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(10, (highlighted < 0 ? selected ?? -1 : highlighted) + 1);
      setHighlighted(next);
      buttonsFocus(next);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      const prev = Math.max(0, (highlighted < 0 ? selected ?? 11 : highlighted) - 1);
      setHighlighted(prev);
      buttonsFocus(prev);
      return;
    }
    if (!isTextEntryTarget(event)) {
      const digit = digitFromKey(event.key);
      if (digit === null) return;
      event.preventDefault();
      const now = Date.now();
      const buffer = bufferRef.current;
      if (buffer.key === '1' && digit === 0 && now - buffer.at <= BUFFER_MS) {
        onChange(10); // "1" then "0" → 10
      } else {
        onChange(digit);
      }
      bufferRef.current = { key: event.key, at: now };
    }
  }

  function buttonsFocus(n: number): void {
    const group = groupRef.current;
    if (!group) return;
    const button = group.querySelector<HTMLButtonElement>(`button[data-n='${n}']`);
    button?.focus();
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            flex: '1 1 auto',
            justifyContent: 'space-between',
          }}
          role="presentation"
        >
          {Array.from({ length: 11 }, (_, n) => n).map((n) => (
            <button
              key={n}
              data-n={n}
              type="button"
              role="radio"
              aria-checked={selected === n}
              aria-label={`${n} out of 10`}
              tabIndex={-1}
              className="ff-option"
              style={{
                width: 34,
                height: 40,
                justifyContent: 'center',
                padding: 0,
                marginBottom: 0,
                color: selected !== undefined && n <= selected ? 'var(--ff-primary)' : undefined,
                fontWeight: selected === n ? 700 : 400,
              }}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {(leftLabel || rightLabel) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--ff-muted)',
            fontSize: 12.5,
            marginTop: 6,
          }}
        >
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
      <p className="ff-hint" aria-hidden="true">
        Press <kbd>0</kbd>–<kbd>9</kbd> (then <kbd>0</kbd> for 10) · <kbd>Enter</kbd> ↵ to continue
      </p>
    </div>
  );
}
