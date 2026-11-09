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
  // §12 focus management: remember who opened the editor (card via Enter, or
  // whatever held focus) so closing it (commit/cancel) restores focus instead
  // of dropping it on <body> when the input unmounts.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Prefill the draft each time the editor opens (card Enter, span click).
  useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);

  // §12: capture who opened the editor BEFORE the auto-focus effect below
  // moves focus into the input (effects run in declaration order). When the
  // editor closes, give focus back to that element — but never steal focus
  // the user has already moved elsewhere.
  useEffect(() => {
    if (editing) {
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        restoreFocusRef.current = document.activeElement;
      }
      return;
    }
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!restore || typeof document === "undefined") return;
    if (document.activeElement === document.body) restore.focus();
  }, [editing]);

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
        dir="auto"
        className="-mx-0.5 cursor-text rounded px-0.5 transition-opacity duration-150 hover:bg-[color:color-mix(in_srgb,var(--ff-primary)_16%,transparent)]"
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
    // §14: the editor follows the text direction of its content (RTL/emoji).
    dir: "auto" as const,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      setDraft(event.target.value);
    },
    onKeyDown: handleKeyDown,
    onBlur: commit,
    className:
      "w-full rounded-lg border border-[color:var(--ff-primary)] bg-[color:var(--ff-bg)] px-1.5 py-1 text-sm text-[color:var(--ff-fg)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--ff-primary)_20%,transparent)] outline-none",
  };

  return multiline ? <textarea {...shared} rows={3} /> : <input type="text" {...shared} />;
}
