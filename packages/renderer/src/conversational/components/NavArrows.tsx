// Up/down navigation arrows (spec §10.2 "progress bar, up/down arrows").
// Down advances (same as Enter), up steps back. Hidden during welcome/done.
import type { CSSProperties, MouseEventHandler } from 'react';

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 'var(--ff-radius)',
  border: '1px solid var(--ff-border)',
  background: 'var(--ff-bg)',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  padding: 0,
};

export interface NavArrowsProps {
  onBack: () => void;
  onNext: () => void;
  /** Back is unavailable on the first question without a welcome screen. */
  canGoBack: boolean;
}

export function NavArrows({ onBack, onNext, canGoBack }: NavArrowsProps) {
  const stop: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div style={{ display: 'inline-flex', gap: 8 }}>
      <button
        type="button"
        aria-label="Previous question"
        style={{ ...buttonStyle, opacity: canGoBack ? 1 : 0.4, cursor: canGoBack ? 'pointer' : 'default' }}
        disabled={!canGoBack}
        onMouseDown={stop}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (canGoBack) onBack();
        }}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Next question"
        style={buttonStyle}
        onMouseDown={stop}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onNext();
        }}
      >
        ↓
      </button>
    </div>
  );
}
