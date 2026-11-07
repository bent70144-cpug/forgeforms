// B8 — static markup tests for the create-document modal's §11 start flow
// ("Blank | Template | Generate with AI"), the §24 inline Pro gate and the
// §11 template gallery.
//
// MERGE NOTE (redesign × B8): the dialog chrome moved to the shared Modal
// primitive, which mounts client-side only (portal to document.body) — so
// <CreateDocumentModal> SSRs to an empty string and role="dialog"/focus-trap/
// Esc live at runtime (asserted in documents-view.test.tsx). All content
// assertions therefore target the exported, SSR-safe <CreateDocumentFields>.
// Rendered with react-dom/server — no DOM env, no interaction; behaviour
// (submit → POST templateId) is covered by the route + client unit tests.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CreateDocumentFields,
  CreateDocumentModal,
  createSubmitLabel,
  type DashboardTemplate,
} from './create-document-modal';

const TEMPLATES: DashboardTemplate[] = [
  {
    id: 'contact-form',
    name: 'Contact form',
    category: 'form',
    description: 'A classic contact form with working logic.',
    blockCount: 6,
    questionCount: 4,
    hasLogic: true,
  },
  {
    id: 'nps-survey',
    name: 'NPS survey',
    category: 'form',
    description: 'One-question NPS with a follow-up.',
    blockCount: 3,
    questionCount: 2,
  },
];

function renderFields(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    h(CreateDocumentFields, {
      templates: TEMPLATES,
      type: 'form',
      onTypeChange: () => {},
      title: '',
      onTitleChange: () => {},
      start: 'blank',
      onStartChange: () => {},
      templateId: null,
      onTemplateIdChange: () => {},
      error: null,
      ...overrides,
    }),
  );
}

describe('<CreateDocumentModal> — §11 start flow', () => {
  it('the client-only dialog chrome SSRs to nothing (Modal primitive)', () => {
    const html = renderToStaticMarkup(
      h(CreateDocumentModal, {
        templates: TEMPLATES,
        onClose: () => {},
        onCreated: () => {},
      }),
    );
    expect(html).toBe('');
  });

  it('offers the three §6 types, the name field, and the segmented start', () => {
    const html = renderFields();
    expect(html).toContain('Form');
    expect(html).toContain('Page');
    expect(html).toContain('Portfolio');
    expect(html).toContain('Blank');
    expect(html).toContain('Template');
    expect(html).toContain('Generate with AI');
    expect(html).toContain('role="group"');
    expect(html).toContain('Start from');
    expect(html).toContain('doc-title');
    // form submit is blocked until a name exists — `required` on the field,
    // plus the client-side disabled guard on the footer Create button
    expect(html).toContain('required');
  });

  it('gates "Generate with AI" in place (§24): disabled + inline Pro badge + note, never a modal', () => {
    const html = renderFields();
    // disabled control with the inline badge
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*?Generate with AI/);
    expect(html).toContain('ff-tpl-pro');
    expect(html).toContain('>Pro</span>');
    expect(html).toContain('AI drafting is available on Pro');
  });

  it('renders the template radio list with names, category chips and stats', () => {
    const html = renderFields();
    // radio list is in the DOM (hidden until the Template segment is picked)
    expect(html).toContain('name="doc-template"');
    expect(html).toContain('value="contact-form"');
    expect(html).toContain('value="nps-survey"');
    expect(html).toContain('Contact form');
    expect(html).toContain('NPS survey');
    expect(html).toContain('ff-tpl-row');
    // category chip + catalog stats from the extended DashboardTemplate fields
    expect(html).toContain('ff-tpl-chip');
    expect(html).toContain('4 questions');
    expect(html).toContain('⚡ logic');
    expect(html).toContain('role="radiogroup"');
    // hidden while the Blank segment is active
    expect(html).toContain('hidden');
  });

  it('marks the picked template row as checked once the Template segment is active', () => {
    const selected = renderFields({ start: 'template', templateId: 'contact-form' });
    expect(selected).toContain('name="doc-template" checked="" value="contact-form"');
    // the hidden ATTRIBUTE (not aria-hidden) is gone once Template is active
    expect(selected).not.toContain('hidden=""');

    const blank = renderFields();
    expect(blank).toContain('hidden=""');
    expect(blank).not.toContain('name="doc-template" checked=""');
  });
});

describe('createSubmitLabel (pure)', () => {
  it('prefers the pending label, then the template-aware label', () => {
    expect(createSubmitLabel({ submitting: true, hasTemplate: false })).toBe('Creating…');
    expect(createSubmitLabel({ submitting: true, hasTemplate: true })).toBe('Creating…');
    expect(createSubmitLabel({ submitting: false, hasTemplate: false })).toBe('Create document');
    expect(createSubmitLabel({ submitting: false, hasTemplate: true })).toBe('Use template');
  });
});
