// Shared types + key handling for question inputs (spec §10.2 keyboard flows).
import type { KeyboardEvent } from 'react';

export interface QuestionInputCommon {
  blockId: string;
  /** Current draft answer for the block (per-kind shape, see bridge/§7.2). */
  value: unknown;
  error: string | null;
  onChange: (value: unknown) => void;
  /** Keyboard advance request (Enter / Ctrl+Enter depending on kind). */
  onSubmit: () => void;
  labelId: string;
  describedByIds: string | undefined;
  autoFocus: boolean;
}

/** '1'..'9' → 1..9, '0' → 0; everything else → null. */
export function digitFromKey(key: string): number | null {
  if (key.length === 1 && key >= '0' && key <= '9') return Number(key);
  return null;
}

/** True when the keydown originated inside a text entry element (digit shortcuts must not fire). */
export function isTextEntryTarget(event: KeyboardEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** Esc is a no-op in the conversational flow (never closes the form). */
export function swallowEscape(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === 'Escape') event.preventDefault();
}
