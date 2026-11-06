// long-text input.
// Keyboard per spec §10.2: Ctrl/Cmd+Enter advances, Enter and Shift+Enter insert
// newlines. SPEC-NOTE: the ticket's generic "Enter=next" rule yields to the
// explicit spec rule for long text (Enter must not block multi-line typing).
import type { KeyboardEvent } from 'react';
import type { QuestionInputCommon } from './shared';
import { swallowEscape } from './shared';

export interface TextAreaProps extends QuestionInputCommon {
  placeholder?: string;
  maxLength?: number;
}

export function TextArea(props: TextAreaProps) {
  const { placeholder, maxLength, error, onChange, onSubmit, labelId, describedByIds, autoFocus, value } = props;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    swallowEscape(event);
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div>
      <textarea
        className="ff-input"
        rows={4}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        aria-labelledby={labelId}
        aria-describedby={describedByIds}
        aria-invalid={error ? true : undefined}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <p className="ff-hint" aria-hidden="true">
        <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line · <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to continue
      </p>
    </div>
  );
}
