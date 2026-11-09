'use client';

// T07 — the builder's Saving/Saved chip (spec §8 "show 'Saving…' / 'Saved'
// indicator"; M2 acceptance "'Saved' appears within 2 s of the last change").
//
// `AutosaveController` (T08) owns the state machine; this module is the UI
// seam: a tiny framework-free status store the controller feeds through its
// `onStatus` callback, and the chip that renders it via useSyncExternalStore.
// Kept independent of the controller class so T08/T09 can adopt it without
// rewiring their constructor options beyond passing `onStatus: store.emit`.

import { useSyncExternalStore } from 'react';
import type { AutosaveStatus } from '@/lib/builder/autosave';

export type SaveStatusSnapshot = {
  status: AutosaveStatus;
  at: number;
  message?: string;
};

const IDLE: SaveStatusSnapshot = { status: 'idle', at: 0 };

/** Minimal observable store (subscribe/getSnapshot/emit) for the chip. */
export function createSaveStatusStore() {
  let snapshot: SaveStatusSnapshot = IDLE;
  const listeners = new Set<() => void>();
  return {
    /** Wire this to `AutosaveController` options.onStatus. */
    emit(status: AutosaveStatus, info: { at: number; message?: string }) {
      snapshot = { status, at: info.at, ...(info.message !== undefined ? { message: info.message } : {}) };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): SaveStatusSnapshot {
      return snapshot;
    },
  };
}

export type SaveStatusStore = ReturnType<typeof createSaveStatusStore>;

const LABELS: Record<AutosaveStatus, string> = {
  idle: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  conflict: 'Conflict — recovering…',
  error: 'Save failed',
  // §4/§7.1: offline keeps the queue — never show a scary error for it.
  offline: 'Offline — changes kept',
  // §7.1 follow-up #3: session expired — the re-auth dialog is shown.
  unauthenticated: 'Sign-in required',
};

/** Chip text for a status (exported for tests). */
export function saveStatusLabel(status: AutosaveStatus, message?: string): string {
  return message && status === 'error' ? `${LABELS[status]}: ${message}` : LABELS[status];
}

/**
 * Saving/Saved indicator — quiet mono microtext with a status dot (Meridian):
 * saved = success, saving/dirty = muted, offline = warning,
 * error/conflict/unauthenticated = danger. Announces transitions politely
 * for screen readers (spec §14.4) and shows the error message verbatim on
 * 'error'. The ff-save-chip classes stay for the test/CSS seam; the visible
 * styling is the inline Meridian microtext (the live region rides the
 * wrapper, so the shared `--ok` ::before dot never double-renders).
 */
const DOT_COLOR: Record<AutosaveStatus, string> = {
  idle: 'var(--ff-success)',
  dirty: 'var(--ff-muted)',
  saving: 'var(--ff-muted)',
  saved: 'var(--ff-success)',
  conflict: 'var(--ff-danger)',
  error: 'var(--ff-danger)',
  // §4/§7.1: offline keeps the queue — warning, not scary error.
  offline: 'var(--ff-warning)',
  // §7.1 follow-up #3: session expired — the re-auth dialog is shown.
  unauthenticated: 'var(--ff-danger)',
};

export function SaveIndicator({ store }: { store: SaveStatusStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const label = saveStatusLabel(snapshot.status, snapshot.message);
  const tone =
    snapshot.status === 'error' || snapshot.status === 'conflict' || snapshot.status === 'unauthenticated'
      ? 'error'
      : 'ok';
  return (
    <span role="status" aria-live="polite">
      <span
        className={`ff-save-chip ff-save-chip--${tone}`}
        data-save-status={snapshot.status}
        style={{
          background: 'transparent',
          borderColor: 'transparent',
          padding: '0.25rem 0.5rem',
          fontFamily: 'var(--ff-font-mono)',
          fontSize: '0.6875rem',
          letterSpacing: '0.01em',
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'error' ? 'var(--ff-danger)' : 'var(--ff-muted)',
        }}
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: DOT_COLOR[snapshot.status] }}
        />
        {label}
      </span>
    </span>
  );
}
