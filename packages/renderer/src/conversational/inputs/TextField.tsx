// short-text / email / number inputs.
// Keyboard: Enter advances (spec §10.2), Shift+Enter is a plain newline (text).
import type { KeyboardEvent } from 'react';
import type { QuestionInputCommon } from './shared';
import { swallowEscape } from './shared';

export interface TextFieldProps extends QuestionInputCommon {
  kind: 'short-text' | 'email' | 'number';
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
}

const TYPE_BY_KIND: Record<TextFieldProps['kind'], string> = {
  'short-text': 'text',
  email: 'email',
  number: 'number',
};

const INPUT_MODE: Partial<Record<TextFieldProps['kind'], 'email' | 'decimal'>> = {
  email: 'email',
  number: 'decimal',
};

export function TextField(props: TextFieldProps) {
  const { kind, placeholder, maxLength, min, max, error, onChange, onSubmit, labelId, describedByIds, autoFocus } = props;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    swallowEscape(event);
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div>
      <input
        className="ff-input"
        type={TYPE_BY_KIND[kind]}
        inputMode={INPUT_MODE[kind]}
        placeholder={placeholder}
        maxLength={kind === 'number' ? undefined : maxLength}
        min={kind === 'number' ? min : undefined}
        max={kind === 'number' ? max : undefined}
        step={kind === 'number' ? 'any' : undefined}
        autoComplete={kind === 'email' ? 'email' : 'off'}
        autoFocus={autoFocus}
        aria-labelledby={labelId}
        aria-describedby={describedByIds}
        aria-invalid={error ? true : undefined}
        value={stringify(props.value)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {/* Enter hint for text questions (spec §14 keyboard flows) */}
      {kind !== 'number' && (
        <p className="ff-hint" aria-hidden="true">
          <kbd>Enter</kbd> ↵ to continue
        </p>
      )}
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}
