'use client';

// Inline text editing for a block's primary prop (builder spec §5.2/§6.5):
// click the label → edit in place; Enter commits (newline in multiline),
// Esc cancels, blur commits. Controlled by the parent card so the card's
// Enter keydown can open the editor (§6.5 keyboard map).
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

export type InlineEditableProps = {
  value: string;
  /** Whether the editor is open (controlled). */
  editing: boolean;
  onBegin: () => void;
  /** Receives the committed (trimmed) text. */
  onCommit: (next: string) => void;
  onCancel: () => void;
  /** Accessible name for the input (icon-only-free fallback: visible text). */
  ariaLabel: string;
  /** Textarea editing: Enter inserts a newline; Ctrl/Cmd+Enter commits. */
  multiline?: boolean;
};

export function InlineEditable({
  value,
  editing,
  onBegin,
  onCommit,
  onCancel,
  ariaLabel,
  multiline = false,
}: InlineEditableProps) {
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Prefill the draft each time the editor opens (card Enter, span click).
  useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);

  // Auto-focus + select on entering edit (spec §5.2).
  useEffect(() => {
    if (!editing) return;
    const el = fieldRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const commit = (): void => {
    const next = draft.trim();
    if (next === "" || next === value.trim()) {
      onCancel(); // empty or untouched → treat as cancel (no history entry)
      return;
    }
    onCommit(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // Keep card-level Enter/Esc and global shortcuts (§6.5) out of typing.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter") {
      if (multiline && !event.metaKey && !event.ctrlKey) return; // newline
      event.preventDefault();
      commit();
    }
  };

  if (!editing) {
    return (
      <span
        data-testid="inline-editable"
        title="Click to edit"
        onClick={onBegin}
        className="cursor-text rounded px-0.5 -mx-0.5 hover:bg-slate-100"
      >
        {value}
      </span>
    );
  }

  const shared = {
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null): void => {
      fieldRef.current = el;
    },
    value: draft,
    "aria-label": ariaLabel,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      setDraft(event.target.value);
    },
    onKeyDown: handleKeyDown,
    onBlur: commit,
    className:
      "w-full rounded border border-[color:var(--ff-primary)] bg-white px-1.5 py-1 text-sm text-slate-900 outline-none",
  };

  return multiline ? <textarea {...shared} rows={3} /> : <input type="text" {...shared} />;
}
