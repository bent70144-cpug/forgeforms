// T28 (issue #28) — axe-core + ARIA/focus/reduced-motion unit tests for the
// conversational renderer (spec §14.4: "ARIA live region announcing validation
// errors and question changes in the conversational renderer"; zero critical
// axe violations).
//
// axe runs in jsdom here (sandbox-friendly) AND in Playwright against the
// /dev/form-plane-harness page in CI (apps/web/e2e/a11y.spec.ts). Color-contrast
// is layout-dependent, so axe reports it as "incomplete" under jsdom — the
// ≥4.5:1 assertion lives in the token audit (docs/a11y-keyboard-sweep.md) and
// the Playwright run.
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationalRenderer } from '../ConversationalRenderer';
import { createMockIngestClient } from '../ingest/mockIngestClient';
import type { IngestClient } from '../ingest/types';
import { CONVERSATIONAL_STYLES } from '../styles';
import { basicDoc, formDoc, q } from '../machine/__tests__/fixtures';
import type { DocumentBody } from '../../../bridge';

let container: HTMLDivElement;
let root: Root | null = null;

/**
 * React tracks controlled inputs by intercepting the value setter — dispatching
 * 'input' alone doesn't fire onChange. Set the value through the prototype
 * setter, then dispatch, exactly like a real user keystroke.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickButtonWithText(text: string): void {
  const ok = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  act(() => {
    ok?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function axeCritical(): Promise<unknown[]> {
  const mod = (await import('axe-core')) as unknown as {
    default?: { run: (el: Element, o?: object) => Promise<{ violations: Array<{ impact: string | null }> }> };
    run?: (el: Element, o?: object) => Promise<{ violations: Array<{ impact: string | null }> }>;
  };
  const axe = mod.default ?? mod;
  if (typeof axe.run !== 'function') throw new Error('axe-core failed to load');
  // Run axe over the whole document (page-level rules matter too); the harness
  // is the only meaningful content of the jsdom page.
  const results = await axe.run(document, {});
  return results.violations.filter((v) => v.impact === 'critical');
}

function mount(doc: DocumentBody, ingest: IngestClient): void {
  act(() => {
    root = createRoot(container);
    root.render(
      <ConversationalRenderer documentId="doc_a11y" document={doc} ingest={ingest} />,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  container.id = 'a11y-root';
  document.body.append(container);
  document.documentElement.lang = 'en';
  document.title = 'FormForge a11y harness';
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe('ConversationalRenderer — WCAG 2.1 AA (spec §14.4)', () => {
  it('announces question changes through an ARIA live region ("Question N of M: label")', () => {
    const mock = createMockIngestClient();
    mount(basicDoc(), mock);

    const status = container.querySelector('[role="status"][aria-live="polite"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe('Question 1 of 3: Your name');

    // Answer question 1 and advance → the live region announces the change.
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      setNativeValue(input, 'Ada Lovelace');
    });
    clickButtonWithText('OK');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Question 2 of 3: Your email',
    );
  });

  it('announces validation errors through role="alert" wired to the input', () => {
    const mock = createMockIngestClient();
    mount(basicDoc(), mock);

    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('OK'));
    act(() => {
      ok?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('This field is required.');
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // The error is part of the input's description (screen readers read it).
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy).toContain(alert?.id);
  });

  it('labels every question input across kinds via aria-labelledby → real label text', () => {
    const mock = createMockIngestClient();
    mount(
      formDoc({
        settings: { autoAdvance: false },
        blocks: [
          q('short-text', { label: 'Name label' }, 'b1'),
          q('long-text', { label: 'Story label' }, 'b2'),
          q('single-select', { label: 'Pick one', options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }] }, 'b3'),
          q('rating', { label: 'Rate it' }, 'b4'),
          q('nps', { label: 'NPS question' }, 'b5'),
        ],
      }),
      mock,
    );

    // Every question kind renders with its label wiring intact; walk the flow.
    const seen: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      const status = container.querySelector('[role="status"]')?.textContent ?? '';
      seen.push(status);
      const labelled = [...container.querySelectorAll<HTMLElement>('[aria-labelledby]')].filter(
        (el) =>
          el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.getAttribute('role') === 'radiogroup',
      );
      expect(
        labelled.length,
        `question ${step + 1} (${status}) exposes a labelled control`,
      ).toBeGreaterThan(0);
      for (const el of labelled) {
        const target = document.getElementById(el.getAttribute('aria-labelledby') as string);
        expect(
          target?.textContent?.length ?? 0,
          `label target of question ${step + 1} is non-empty`,
        ).toBeGreaterThan(0);
      }
      // Advance: type/click the first actionable control then OK.
      const radio = container.querySelector<HTMLButtonElement>('[role="radio"]');
      if (radio) {
        act(() => {
          radio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          // Instant-answer kinds (single-select/rating/nps) have no OK button;
          // Enter on the radiogroup is the keyboard commit (spec §10.2).
          radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
      }
      const text = container.querySelector<HTMLInputElement>('input[type="text"]');
      const area = container.querySelector('textarea');
      act(() => {
        if (text && text.value === '') setNativeValue(text, 'x');
        if (area && area.value === '') setNativeValue(area, 'x');
      });
      clickButtonWithText('OK');
    }
    // The walk covered every question in order (nps is the last kind and has
    // no OK button — instant-answer kinds commit via their controls).
    expect(seen).toEqual([
      'Question 1 of 5: Name label',
      'Question 2 of 5: Story label',
      'Question 3 of 5: Pick one',
      'Question 4 of 5: Rate it',
      'Question 5 of 5: NPS question',
    ]);
  });

  it('focuses the first input of each question (keyboard flows, spec §10.2)', () => {
    const mock = createMockIngestClient();
    mount(basicDoc(), mock);
    expect(document.activeElement).toBe(container.querySelector('input[type="text"]'));
  });

  it('has zero critical axe violations on the question screen (axe-core run)', async () => {
    const mock = createMockIngestClient();
    mount(basicDoc(), mock);
    const critical = await axeCritical();
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  it('has zero critical axe violations on the welcome screen', async () => {
    const mock = createMockIngestClient();
    mount(
      formDoc({
        welcome: { enabled: true, title: 'Welcome aboard', body: 'Ready when you are.' },
        blocks: [q('short-text', { label: 'Your name', required: true }, 'b1')],
        endings: [{ id: 'e1', title: 'Thanks!' }],
      }),
      mock,
    );
    const critical = await axeCritical();
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  it('has zero critical axe violations while a validation error is visible', async () => {
    const mock = createMockIngestClient();
    mount(basicDoc(), mock);
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('OK'));
    act(() => {
      ok?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const critical = await axeCritical();
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  it('respects prefers-reduced-motion: screen animation and progress transition disabled', () => {
    // jsdom does not cascade document stylesheets into getComputedStyle, so the
    // emulation assertion is stylesheet-level here; the real emulation test
    // runs in Playwright (reducedMotion: 'reduce', CI).
    expect(CONVERSATIONAL_STYLES).toContain('@media (prefers-reduced-motion: reduce)');
    const mediaBlock = CONVERSATIONAL_STYLES.slice(
      CONVERSATIONAL_STYLES.indexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(mediaBlock).toContain('.ff-screen { animation: none; }');
    expect(mediaBlock).toContain('.ff-progress-fill { transition: none; }');
    // No animation/transition survives reduced motion inside the root.
    expect(mediaBlock).toContain('animation-duration: 0.01ms !important');
    expect(mediaBlock).toContain('transition-duration: 0.01ms !important');
    // Visible focus is present for every interactive element (spec §14.4).
    expect(CONVERSATIONAL_STYLES).toContain(':focus-visible');
    expect(CONVERSATIONAL_STYLES).toContain('outline: 2px solid var(--ff-primary)');
  });

  it('exposes the progress bar as an accessible determinate progressbar', () => {
    const mock = createMockIngestClient();
    mount(basicDoc(), mock);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-label')).toBe('Form progress');
    expect(Number(bar?.getAttribute('aria-valuemin'))).toBe(0);
    expect(Number(bar?.getAttribute('aria-valuemax'))).toBe(100);
    expect(Number(bar?.getAttribute('aria-valuenow'))).toBe(0);
  });

  it('keeps the honeypot out of the accessibility tree and tab order', () => {
    const mock = createMockIngestClient();
    mount(basicDoc(), mock);
    const honeypot = container.querySelector('input[name="_hp"]') as HTMLInputElement;
    expect(honeypot.getAttribute('aria-hidden')).toBe('true');
    expect(honeypot.tabIndex).toBe(-1);
  });
});
