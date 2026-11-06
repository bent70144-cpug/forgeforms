// T07 — component smoke tests for the dashboard documents view (spec §14.1.2).
// Rendered with react-dom/server — no extra test dependencies, no DOM env.
// Interactive behaviour (fetch, localStorage, clipboard) is covered by the
// client unit tests; Playwright e2e covers the browser flows.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreateDocumentModal, type DashboardTemplate } from './create-document-modal';
import { DocumentsView } from './documents-view';

const TEMPLATES: DashboardTemplate[] = [
  { id: 'contact-form', name: 'Contact form', category: 'form' },
  { id: 'launch-page', name: 'Launch page', category: 'page' },
];

describe('<DocumentsView>', () => {
  it('renders the toolbar with the grid/list toggle and the New action (initial loading state)', () => {
    const html = renderToStaticMarkup(h(DocumentsView, { templates: TEMPLATES }));
    expect(html).toContain('Documents');
    expect(html).toContain('Grid');
    expect(html).toContain('List');
    expect(html).toContain('New document');
    // loading skeletons, never a blank screen (spec §14.2)
    expect(html).toContain('ff-skeleton');
    expect(html).toContain('aria-hidden');
  });
});

describe('<CreateDocumentModal>', () => {
  it('offers the three §6 types, name field, and blank/template start', () => {
    const html = renderToStaticMarkup(
      h(CreateDocumentModal, {
        templates: TEMPLATES,
        onClose: () => {},
        onCreated: () => {},
      }),
    );
    expect(html).toContain('New document');
    expect(html).toContain('Form');
    expect(html).toContain('Page');
    expect(html).toContain('Portfolio');
    expect(html).toContain('Blank');
    expect(html).toContain('Template');
    expect(html).toContain('doc-title');
    // form submit is blocked until a name exists
    expect(html).toContain('disabled');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });
});
