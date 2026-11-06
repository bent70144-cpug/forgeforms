// T07 — tests for the Saving/Saved chip seam (spec §8) + the AutosaveController
// wiring contract (status store ⇄ onStatus).
// Static-render smoke tests with react-dom/server; the controller state
// machine itself is covered by lib/builder/autosave.test.ts (T08).
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createSaveStatusStore, SaveIndicator, saveStatusLabel } from './save-indicator';

describe('createSaveStatusStore', () => {
  it('starts idle, emits snapshots with stable identity, notifies subscribers', () => {
    const store = createSaveStatusStore();
    expect(store.getSnapshot()).toEqual({ status: 'idle', at: 0 });

    const seen: string[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().status));

    store.emit('saving', { at: 1 });
    store.emit('saved', { at: 2 });
    expect(seen).toEqual(['saving', 'saved']);
    expect(store.getSnapshot()).toEqual({ status: 'saved', at: 2 });
    expect(store.getSnapshot()).toBe(store.getSnapshot()); // stable ref for useSyncExternalStore

    unsubscribe();
    store.emit('dirty', { at: 3 });
    expect(seen).toEqual(['saving', 'saved']); // no notify after unsubscribe
    expect(store.getSnapshot().status).toBe('dirty');
  });
});

describe('saveStatusLabel', () => {
  it('maps the §8 indicator states, including the error message', () => {
    expect(saveStatusLabel('idle')).toBe('Saved');
    expect(saveStatusLabel('dirty')).toBe('Unsaved changes');
    expect(saveStatusLabel('saving')).toBe('Saving…');
    expect(saveStatusLabel('saved')).toBe('Saved');
    expect(saveStatusLabel('conflict')).toBe('Conflict — recovering…');
    expect(saveStatusLabel('error')).toBe('Save failed');
    expect(saveStatusLabel('error', 'Too many conflicting edits — reload from the server')).toBe(
      'Save failed: Too many conflicting edits — reload from the server',
    );
  });
});

describe('<SaveIndicator>', () => {
  it('renders the current status chip with a polite live region', () => {
    const store = createSaveStatusStore();
    const html = renderToStaticMarkup(h(SaveIndicator, { store }));
    expect(html).toContain('Saved');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('ff-save-chip');
  });

  it('renders an error tone with the controller message', () => {
    const store = createSaveStatusStore();
    store.emit('error', { at: 1, message: 'boom' });
    const html = renderToStaticMarkup(h(SaveIndicator, { store }));
    expect(html).toContain('Save failed: boom');
    expect(html).toContain('ff-save-chip--error');
  });

  it('renders the saving state', () => {
    const store = createSaveStatusStore();
    store.emit('saving', { at: 1 });
    expect(renderToStaticMarkup(h(SaveIndicator, { store }))).toContain('Saving…');
  });
});
