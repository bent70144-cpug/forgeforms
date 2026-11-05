// single-select + dropdown inputs (spec §7.2).
// - single-select: option buttons, optional "Other" free text, optional randomize
// - dropdown: same list with an optional search filter (searchable prop)
// Keyboard: ↑/↓ move the highlight, 1–9 pick an option (auto-advance follows),
// Enter commits the highlight and advances, Ctrl/Cmd+Enter advances as-is,
// Esc is a no-op. Auto-advance (spec §10.2 <300ms) is driven by the parent.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { asSelectValue, type SelectOption } from '../machine/helpers';
import type { QuestionInputCommon } from './shared';
import { digitFromKey, isTextEntryTarget, swallowEscape } from './shared';

export interface ChoiceListProps extends QuestionInputCommon {
  options: SelectOption[];
  allowOther?: boolean;
  searchable?: boolean;
  /** Applied by the caller when the block sets randomize (kept out for determinism). */
  randomized?: boolean;
}

export function ChoiceList(props: ChoiceListProps) {
  const {
    options,
    allowOther = false,
    searchable = false,
    value,
    error,
    onChange,
    onSubmit,
    labelId,
    describedByIds,
  } = props;
  const selected = asSelectValue(value);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const otherInputRef = useRef<HTMLInputElement | null>(null);

  const filterable = searchable;
  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!filterable || query === '') return options;
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [filterable, query, options]);
  const otherVisible = allowOther && (!filterable || query === '' || 'other'.includes(query));
  const total = visible.length + (otherVisible ? 1 : 0);

  // Initial focus: search box for searchable dropdowns, else the option group.
  useEffect(() => {
    if (!filterable) groupRef.current?.focus();
  }, [filterable]);

  function focusIndex(index: number): void {
    if (index < 0 || index >= total) return;
    setHighlighted(index);
    buttonsRef.current[index]?.focus();
  }

  function commitIndex(index: number): void {
    if (index < 0 || index >= total) return;
    if (otherVisible && index >= visible.length) {
      onChange({ other: selected.other ?? '' });
      window.requestAnimationFrame(() => otherInputRef.current?.focus());
      return;
    }
    const option = visible[index];
    if (option) onChange({ optionId: option.id });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    swallowEscape(event);
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === 'Enter') {
      event.preventDefault();
      if (!mod && highlighted >= 0) commitIndex(highlighted);
      else if (!mod && filterable && highlighted < 0 && visible.length > 0) commitIndex(0);
      onSubmit(); // Enter=next; the validation gate protects required questions
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusIndex(highlighted < 0 ? 0 : Math.min(highlighted + 1, total - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusIndex(highlighted < 0 ? total - 1 : Math.max(highlighted - 1, 0));
      return;
    }
    // Digit shortcuts 1–9; never fire while the user is typing in a text box.
    if (!filterable && !isTextEntryTarget(event)) {
      const digit = digitFromKey(event.key);
      if (digit !== null && digit >= 1 && digit <= total) {
        event.preventDefault();
        commitIndex(digit - 1);
      }
    }
  }

  function bindButton(index: number): (node: HTMLButtonElement | null) => void {
    return (node) => {
      buttonsRef.current[index] = node;
    };
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
      {filterable && (
        <input
          className="ff-input"
          type="text"
          placeholder="Type to search…"
          aria-label="Search options"
          autoComplete="off"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setHighlighted(event.target.value === '' ? -1 : 0);
          }}
        />
      )}
      <div style={{ marginTop: filterable ? 12 : 0 }}>
        {visible.map((option, index) => (
          <button
            key={option.id}
            ref={bindButton(index)}
            type="button"
            role="radio"
            aria-checked={selected.optionId === option.id}
            tabIndex={-1}
            className="ff-option"
            onClick={() => commitIndex(index)}
          >
            <span className="ff-option-key" aria-hidden="true">
              {index + 1}
            </span>
            {option.label}
          </button>
        ))}
        {otherVisible && (
          <div>
            <button
              ref={bindButton(visible.length)}
              type="button"
              role="radio"
              aria-checked={selected.other !== undefined}
              tabIndex={-1}
              className="ff-option"
              onClick={() => commitIndex(visible.length)}
            >
              <span className="ff-option-key" aria-hidden="true">
                {visible.length + 1}
              </span>
              Other
            </button>
            {selected.other !== undefined && (
              <input
                ref={otherInputRef}
                className="ff-input"
                type="text"
                placeholder="Your answer…"
                aria-label="Other (please specify)"
                autoComplete="off"
                autoFocus={selected.other === ''}
                value={selected.other}
                onChange={(event) => onChange({ other: event.target.value })}
                onKeyDown={(event) => {
                  swallowEscape(event);
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
              />
            )}
          </div>
        )}
        {visible.length === 0 && !otherVisible && (
          <p className="ff-hint">No options match “{search}”.</p>
        )}
      </div>
      {!filterable && (
        <p className="ff-hint" aria-hidden="true">
          Press <kbd>1</kbd>–<kbd>{Math.min(total, 9)}</kbd> to pick · <kbd>Enter</kbd> ↵ to continue
        </p>
      )}
    </div>
  );
}
