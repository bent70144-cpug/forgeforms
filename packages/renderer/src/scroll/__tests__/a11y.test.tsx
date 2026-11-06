// T28 (issue #28) — axe-core unit test for the scroll renderer (spec §14.4:
// zero critical axe violations on the public-page surface).
//
// The scroll renderer is pure server components: render with
// react-dom/server, mount the markup into jsdom, then run axe over it.
// CI additionally runs Playwright axe against the live /p/:slug plane.
// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { ScrollRenderer } from '../ScrollRenderer';
import type { Snapshot } from '../../bridge';

function snapshot(blocks: Snapshot['blocks'], overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    documentId: 'doc_scroll_a11y',
    versionId: 'ver_a11y',
    type: 'page',
    title: 'A11y landing',
    locale: 'en',
    cssVars: { 'color.bg': '#ffffff' },
    blocks,
    settings: { showBranding: true },
    ...overrides,
  };
}

async function axeCritical(): Promise<unknown[]> {
  const mod = (await import('axe-core')) as unknown as {
    default?: { run: (el: Element, o?: object) => Promise<{ violations: Array<{ impact: string | null }> }> };
    run?: (el: Element, o?: object) => Promise<{ violations: Array<{ impact: string | null }> }>;
  };
  const axe = mod.default ?? mod;
  if (typeof axe.run !== 'function') throw new Error('axe-core failed to load');
  // documentElement (not `document`) — axe's API types take an Element;
  // page-level rules (lang, title) still evaluate from the live document.
  const results = await axe.run(document.documentElement, {});
  return results.violations.filter((v) => v.impact === 'critical');
}

beforeAll(() => {
  // Page-level rules (lang, title) are owned by the host layout
  // (apps/web/app/layout.tsx renders <html lang="en"> + metadata title).
  document.documentElement.lang = 'en';
  document.title = 'A11y landing';
});

describe('ScrollRenderer — WCAG 2.1 AA (spec §14.4)', () => {
  it('has zero critical axe violations for a full portfolio/page snapshot', async () => {
    document.body.innerHTML = renderToString(
      ScrollRenderer({
        snapshot: snapshot([
          {
            id: 'h1',
            kind: 'hero',
            props: {
              headline: 'Design that ships',
              subtitle: 'Product design for fast-moving teams.',
              imageUrl: null,
              cta: { label: 'See my work', href: '#work' },
            },
          },
          {
            id: 't1',
            kind: 'text',
            props: { html: '<p>About me — I design interfaces.</p>' },
          },
          {
            id: 'i1',
            kind: 'image',
            props: { src: 'https://example.com/cover.png', alt: 'Cover artwork', caption: 'Cover', width: 800, height: 600 },
          },
          { id: 'b1', kind: 'button', props: { label: 'Email me', href: 'mailto:me@example.com', variant: 'primary' } },
        ] as Snapshot['blocks']),
      }),
    );

    expect(document.querySelector('.ff-section-hero')).not.toBeNull();
    const critical = await axeCritical();
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  it('has zero critical axe violations for the "gone" (410) view', async () => {
    const { GoneView } = await import('../sections/GoneView');
    document.body.innerHTML = renderToString(<GoneView locale="en" />);
    const critical = await axeCritical();
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  it('keeps images accessible: alt text passes through from the snapshot', async () => {
    document.body.innerHTML = renderToString(
      ScrollRenderer({
        snapshot: snapshot([
          {
            id: 'i1',
            kind: 'image',
            props: { src: 'https://example.com/a.png', alt: 'Studio photo', caption: '', width: 100, height: 100 },
          },
        ] as Snapshot['blocks']),
      }),
    );
    const img = document.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('Studio photo');
    const critical = await axeCritical();
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });
});
