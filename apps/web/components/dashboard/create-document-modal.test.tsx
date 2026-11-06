// B8 — static markup tests for the create-document modal's §11 start flow
// ("Blank | Template | Generate with AI") and the §24 inline Pro gate.
// Rendered with react-dom/server — no DOM env, no interaction; behaviour
// (submit → POST templateId) is covered by the route + client unit tests.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreateDocumentModal, createSubmitLabel, type DashboardTemplate } from './create-document-modal';

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

function renderModal(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    h(CreateDocumentModal, {
      templates: TEMPLATES,
      onClose: () => {},
      onCreated: () => {},
      ...overrides,
    }),
  );
}

describe('<CreateDocumentModal> — §11 start flow', () => {
  it('renders the three segmented options: Blank | Template | Generate with AI', () => {
    const html = renderModal();
    expect(html).toContain('Blank');
    expect(html).toContain('Template');
    expect(html).toContain('Generate with AI');
    expect(html).toContain('role="group"');
    expect(html).toContain('Start from');
  });

  it('gates "Generate with AI" in place (§24): disabled + inline Pro badge + note, never a modal', () => {
    const html = renderModal();
    // disabled control with the inline badge
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*?Generate with AI/);
    expect(html).toContain('ff-tpl-pro');
    expect(html).toContain('>Pro</span>');
    expect(html).toContain('AI drafting is available on Pro');
  });

  it('renders the template radio list with names, category chips and stats', () => {
    const html = renderModal();
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

  it('keeps the dialog semantics (role, labelling, Esc-close hook, blocked submit)', () => {
    const html = renderModal();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="create-document-title"');
    expect(html).toContain('doc-title');
    // submit is disabled until a name exists (and stays disabled while pending)
    expect(html).toContain('disabled');
  });

  it('label switches to "Use template" when a template is selected (initialStart)', () => {
    const selected = renderModal({ initialStart: 'template', initialTemplateId: 'contact-form' });
    expect(selected).toContain('>Use template<');
    expect(selected).not.toContain('>Create document<');
    // the chosen row is the checked radio
    expect(selected).toContain('name="doc-template" checked="" value="contact-form"');

    const blank = renderModal();
    expect(blank).toContain('>Create document<');
    expect(blank).not.toContain('>Use template<');
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
