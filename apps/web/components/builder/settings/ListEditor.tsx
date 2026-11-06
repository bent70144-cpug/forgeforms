'use client';

// Email list editor (builder spec §6.6 Notifications): add on Enter, remove
// with ×, validated inline, capped (max 10 — entitlement unknown client-side,
// §24 note). The cap error is surfaced inline; a field-level error never
// blocks autosave (§6.6) — it only styles the input and shows a message.

import { useState, type KeyboardEvent } from "react";
import { FF_SET_INPUT_CLASS } from "./FieldRow";
import { MAX_NOTIFY_EMAILS, validateEmailDraft, type EmailDraftResult } from "./settings-helpers";

const DRAFT_REASON_MESSAGE: Record<Exclude<EmailDraftResult, { ok: true }>["reason"], string> = {
  empty: "Enter an email address.",
  invalid: "That doesn't look like a valid email address.",
  duplicate: "That address is already on the list.",
  limit: `Maximum of ${MAX_NOTIFY_EMAILS} recipients reached.`,
};

export function EmailListEditor({
  emails,
  onAdd,
  onRemove,
  max = MAX_NOTIFY_EMAILS,
  disabled = false,
  inputId = "ff-set-notify-email-input",
}: {
  emails: readonly string[];
  onAdd: (email: string) => void;
  onRemove: (email: string) => void;
  max?: number;
  disabled?: boolean;
  inputId?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const atLimit = emails.length >= max;

  const commit = (): void => {
    const result = validateEmailDraft(draft, emails, max);
    if (!result.ok) {
      setError(result.reason === "empty" && draft.trim() === "" && !atLimit ? null : DRAFT_REASON_MESSAGE[result.reason]);
      return;
    }
    setError(null);
    onAdd(result.email);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" htmlFor={inputId}>
        Notify emails ({emails.length}/{max})
      </label>
      <div className="flex gap-1">
        <input
          id={inputId}
          type="email"
          value={draft}
          disabled={disabled || atLimit}
          placeholder={atLimit ? `Limit of ${max} reached` : "name@company.com"}
          aria-invalid={error !== null}
          aria-describedby={error ? `${inputId}-error` : undefined}
          data-testid="ff-set-notify-email-input"
          className={FF_SET_INPUT_CLASS}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error !== null) setError(null);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          disabled={disabled || atLimit}
          onClick={commit}
          className="ff-set-btn"
          aria-label="Add email recipient"
        >
          Add
        </button>
      </div>
      {error ? (
        <p className="ff-set-note ff-set-note--error" role="alert" id={`${inputId}-error`} data-testid="ff-set-notify-email-error">
          {error}
        </p>
      ) : null}
      {emails.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="ff-set-notify-email-list">
          {emails.map((email) => (
            <li key={email.toLowerCase()} className="ff-set-chip">
              <span className="min-w-0 truncate">{email}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(email)}
                aria-label={`Remove ${email}`}
                className="ff-set-chip-remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
