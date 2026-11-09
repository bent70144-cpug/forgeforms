'use client';

// B3 — create-document modal (spec §14.1.2): type (Form / Page / Portfolio),
// name, blank or template. Emits the created detail so the parent can refresh
// the dashboard list (or navigate into the builder).
// Errors render inline in the §4 shape (server messages + field details).
//
// The dialog chrome is the shared Modal primitive (portal to document.body,
// focus trap, Esc, scroll lock) — it mounts client-side only, so the server
// HTML of <CreateDocumentModal> is empty. The field markup lives in the
// exported, SSR-safe <CreateDocumentFields> (covered by the smoke tests).
//
// T07/B8 additions merged onto the B3 redesign: the Template segment lists
// the workspace catalog as a radio gallery (name + category chip + stats;
// submit POSTs `{ type, title, templateId }` — the API instantiates the
// template server-side), "Generate with AI" renders as a DISABLED segment
// with an inline "Pro" badge (§24: upgrade modals are forbidden; entitlement
// resolution is server-side via `can()`, so the badge is static), the
// primary-button label switches to "Use template" via the unit-tested
// createSubmitLabel, and §15 tracks "template_used" (the id only).
//
// ?template=<slug> handoff (template detail CTA → /dashboard): when
// `prefillTemplate` names a known template, the modal initialises with that
// type + slug on the Template tab; it re-syncs if the prop changes while
// mounted.
//
// "aurora glass" presentation pass: type tiles use the gradient recipe
// (--ff-grad endpoints at low opacity + --ff-accent-soft icon) with violet
// selection, and the §11 template gallery renders as a two-column choice grid
// (sm+) with a per-template aurora swatch. Class names / radio contract are
// unchanged — the ff-tpl-* recipes in globals.css stay canonical (the `grid!`
// important utility overrides only the gallery's display/gap; the preflight
// [hidden] rule still wins, so screen readers keep the stable hidden DOM).

import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import {
  createDocument,
  DocumentsApiError,
  type DocumentDetailDto,
  type DocumentType,
} from '@/lib/documents/client';
import { track } from '@/lib/telemetry';
import { Modal } from '@/components/ui/modal';
import { Icon, type IconName } from '@/components/ui/icons';
import { BANNER_ERROR, BTN_GHOST, BTN_PRIMARY, SEG, SEG_BTN } from '@/lib/ui';

export type DashboardTemplate = {
  id: string;
  name: string;
  category: DocumentType;
  // --- optional catalog metadata (extra fields only — the original
  // `{ id, name, category }` contract stays backward-compatible) ---------
  description?: string;
  tags?: string[];
  blockCount?: number;
  questionCount?: number;
  hasLogic?: boolean;
  /** Marketing gradient classes (mirrors the /templates card thumbnail). */
  gradient?: string;
  /** Reserved for the renderer-based thumbnail when the preview lands. */
  previewUrl?: string;
};

export type CreateDocumentError = {
  message: string;
  details?: { path?: string; message: string }[];
};

const TYPES: { value: DocumentType; label: string; hint: string; icon: IconName }[] = [
  { value: 'form', label: 'Form', hint: 'Conversational surveys and quizzes', icon: 'fileText' },
  { value: 'page', label: 'Page', hint: 'Scroll landing page', icon: 'file' },
  { value: 'portfolio', label: 'Portfolio', hint: 'Scroll showcase of work', icon: 'layers' },
];

const CATEGORY_LABEL: Record<DocumentType, string> = {
  form: 'Form',
  page: 'Landing page',
  portfolio: 'Portfolio',
};

export type StartMode = 'blank' | 'template';

/** Primary-button label (pure — unit-tested): "Use template" wins once a template is picked. */
export function createSubmitLabel(state: { submitting: boolean; hasTemplate: boolean }): string {
  if (state.submitting) return 'Creating…';
  return state.hasTemplate ? 'Use template' : 'Create document';
}

const FORM_ID = 'ff-create-document';

/** Resolve the ?template= handoff — only trust slugs present in the catalog. */
function resolvePrefill(
  templates: DashboardTemplate[],
  prefillTemplate?: string,
): { type: DocumentType; templateId: string } | null {
  const match = prefillTemplate ? templates.find((t) => t.id === prefillTemplate) : undefined;
  return match ? { type: match.category, templateId: match.id } : null;
}

export function CreateDocumentModal({
  templates,
  prefillTemplate,
  onClose,
  onCreated,
  initialStart = 'blank',
  initialTemplateId = null,
}: {
  templates: DashboardTemplate[];
  prefillTemplate?: string;
  onClose: () => void;
  onCreated: (doc: DocumentDetailDto) => void | Promise<void>;
  /** Initial segment (deep-link/test hook; users start on Blank). */
  initialStart?: StartMode;
  /** Initial template pick (pairs with initialStart="template"). */
  initialTemplateId?: string | null;
}) {
  const initialPrefill = resolvePrefill(templates, prefillTemplate);
  const [type, setType] = useState<DocumentType>(initialPrefill?.type ?? 'form');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<StartMode>(initialPrefill ? 'template' : initialStart);
  const [templateId, setTemplateId] = useState<string | null>(
    initialPrefill?.templateId ?? initialTemplateId,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<CreateDocumentError | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Re-sync when the ?template= handoff changes while mounted (client nav from
  // a template detail page without remounting the dashboard).
  useEffect(() => {
    const next = resolvePrefill(templates, prefillTemplate);
    if (next) {
      setType(next.type);
      setTemplateId(next.templateId);
      setStart('template');
    }
  }, [templates, prefillTemplate]);

  // The Modal primitive focuses the panel; deepen focus to the name field.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const typeTemplates = templates.filter((t) => t.category === type);
  // Reset the template choice when the type changes and the pick no longer fits.
  const effectiveTemplateId =
    start === 'template' && templateId && typeTemplates.some((t) => t.id === templateId)
      ? templateId
      : null;
  const hasTemplate = effectiveTemplateId !== null;
  const submitDisabled =
    submitting || title.trim().length === 0 || (start === 'template' && !hasTemplate);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const doc = await createDocument({
        type,
        title: title.trim(),
        templateId: effectiveTemplateId ?? undefined,
      });
      // §15: template usage telemetry — the template id only, never content.
      if (effectiveTemplateId) track('template_used', { id: effectiveTemplateId });
      await onCreated(doc);
    } catch (err) {
      if (err instanceof DocumentsApiError) {
        setError({
          message: err.message,
          details: err.details?.map((d) => ({ path: d.path, message: d.message })),
        });
      } else {
        setError({ message: 'Network error while creating the document.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New document"
      description="Start from a blank document or a template."
      footer={
        <>
          <button type="button" className={BTN_GHOST} onClick={onClose}>
            Cancel
          </button>
          {/* Submit lives in the Modal footer, outside the <form> — the form
              attribute keeps the association (and the disabled guard). */}
          <button type="submit" form={FORM_ID} disabled={submitDisabled} className={BTN_PRIMARY}>
            <Icon name="plus" size={16} />
            {createSubmitLabel({ submitting, hasTemplate })}
          </button>
        </>
      }
    >
      {/* min-height so the panel does not jump when the Template gallery appears */}
      <form id={FORM_ID} onSubmit={(e) => void submit(e)} className="flex min-h-[14rem] flex-col gap-4">
        <CreateDocumentFields
          templates={templates}
          type={type}
          onTypeChange={(t) => {
            setType(t);
            setTemplateId(null);
          }}
          title={title}
          onTitleChange={setTitle}
          titleInputRef={nameRef}
          start={start}
          onStartChange={setStart}
          templateId={templateId}
          onTemplateIdChange={setTemplateId}
          error={error}
        />
      </form>
    </Modal>
  );
}

/**
 * The modal's fields, without dialog chrome — SSR-safe so the smoke tests can
 * assert the offered types/name/start controls, the §11 template gallery and
 * the §24 Pro gate directly. Dialog semantics (role="dialog", focus trap,
 * Esc) come from the shared Modal primitive at runtime.
 */
export function CreateDocumentFields({
  templates,
  type,
  onTypeChange,
  title,
  onTitleChange,
  titleInputRef,
  start,
  onStartChange,
  templateId,
  onTemplateIdChange,
  error,
}: {
  templates: DashboardTemplate[];
  type: DocumentType;
  onTypeChange: (type: DocumentType) => void;
  title: string;
  onTitleChange: (title: string) => void;
  titleInputRef?: Ref<HTMLInputElement>;
  start: StartMode;
  onStartChange: (start: StartMode) => void;
  templateId: string | null;
  onTemplateIdChange: (templateId: string | null) => void;
  error: CreateDocumentError | null;
}) {
  const typeTemplates = templates.filter((t) => t.category === type);
  const effectiveTemplateId =
    start === 'template' && templateId && typeTemplates.some((t) => t.id === templateId)
      ? templateId
      : null;

  return (
    <>
      <fieldset>
        <legend className="text-sm font-medium text-[var(--ff-fg)]">Type</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TYPES.map((t) => {
            const selected = type === t.value;
            return (
              <label
                key={t.value}
                title={t.hint}
                className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ff-primary)] ${
                  selected
                    ? 'border-[var(--ff-primary)] bg-[color-mix(in_srgb,var(--ff-primary)_6%,var(--ff-card))] ring-2 ring-[color-mix(in_srgb,var(--ff-primary)_28%,transparent)] ring-offset-0'
                    : 'border-[var(--ff-border)] hover:border-[var(--ff-border-strong)]'
                }`}
              >
                <input
                  type="radio"
                  name="doc-type"
                  value={t.value}
                  checked={selected}
                  onChange={() => onTypeChange(t.value)}
                  className="sr-only"
                />
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background:
                        'linear-gradient(135deg, color-mix(in srgb, var(--ff-primary) 26%, transparent), color-mix(in srgb, var(--ff-primary-2) 20%, transparent)), var(--ff-card)',
                      boxShadow:
                        'inset 0 0 0 1px color-mix(in srgb, var(--ff-primary) 28%, transparent)',
                      color: 'var(--ff-accent-soft)',
                    }}
                  >
                    <Icon name={t.icon} size={15} />
                  </span>
                  <span className="text-sm font-medium text-[var(--ff-fg)]">{t.label}</span>
                </span>
                <span className="text-xs leading-snug text-[var(--ff-muted)]">{t.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="ff-field">
        <label htmlFor="doc-title">Name</label>
        <input
          id="doc-title"
          ref={titleInputRef}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={300}
          required
          placeholder="e.g. Contact form"
          aria-invalid={error?.details?.some((d) => d.path === 'title') ?? undefined}
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-[var(--ff-fg)]">Start from</legend>
        {/* §11 segmented choice: Blank | Template | Generate with AI. The
            AI segment is the §24 gated control: disabled + inline Pro badge
            (never a modal), its flow lives in the AI workbench. */}
        <div className={`${SEG} mt-2`} role="group" aria-label="Start from">
          <button
            type="button"
            className={SEG_BTN}
            aria-pressed={start === 'blank'}
            onClick={() => onStartChange('blank')}
          >
            Blank
          </button>
          <button
            type="button"
            className={SEG_BTN}
            aria-pressed={start === 'template'}
            onClick={() => onStartChange('template')}
          >
            Template
          </button>
          <button type="button" disabled className={`${SEG_BTN} ff-tpl-ai`} title="AI drafting is available on Pro">
            Generate with AI <span className="ff-tpl-pro">Pro</span>
          </button>
        </div>
        <p className="ff-tpl-note">AI drafting is available on Pro.</p>

        {/* §11 gallery: radio grid (name + aurora swatch + category chip +
            stats). Rendered (hidden) even before the segment is picked so
            screen readers get a stable DOM and the choice survives segment
            toggling. Two columns from sm up — `grid!`/`gap-2!` override the
            unlayered .ff-tpl-list recipe; the preflight [hidden] rule keeps
            winning while hidden. */}
        <div
          className="ff-tpl-list grid! gap-2! sm:grid-cols-2"
          role="radiogroup"
          aria-label={`${CATEGORY_LABEL[type]} templates`}
          hidden={start !== 'template' || typeTemplates.length === 0}
        >
          {typeTemplates.map((t) => {
            const selected = effectiveTemplateId === t.id;
            const stats = [
              typeof t.blockCount === 'number' ? `${t.blockCount} blocks` : null,
              typeof t.questionCount === 'number' && t.questionCount > 0
                ? `${t.questionCount} questions`
                : null,
              t.hasLogic ? '⚡ logic' : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <label
                key={t.id}
                className={`ff-tpl-row${selected ? ' ff-tpl-row--selected' : ''}`}
                title={t.description ?? undefined}
              >
                <input
                  type="radio"
                  name="doc-template"
                  value={t.id}
                  checked={selected}
                  onChange={() => onTemplateIdChange(t.id)}
                  className="ff-tpl-radio"
                />
                {/* aurora swatch — token-only gradient, mirrors the catalog
                    thumbnail slot without hard-coding marketing colors */}
                <span
                  aria-hidden="true"
                  className="h-7 w-7 shrink-0 rounded-lg"
                  style={{
                    background:
                      'linear-gradient(135deg, color-mix(in srgb, var(--ff-primary) 55%, transparent), color-mix(in srgb, var(--ff-primary-2) 55%, transparent))',
                    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--ff-fg) 12%, transparent)',
                  }}
                />
                <span className="ff-tpl-text">
                  <span className="ff-tpl-name">{t.name}</span>
                  {(stats || t.description) && (
                    <span className="ff-tpl-meta">{stats || t.description}</span>
                  )}
                </span>
                <span className="ff-badge ff-badge--accent ff-tpl-chip">
                  {CATEGORY_LABEL[t.category]}
                </span>
              </label>
            );
          })}
        </div>
        {start === 'template' && typeTemplates.length === 0 && (
          <p className="ff-tpl-note">No templates for this type yet.</p>
        )}
      </fieldset>

      {error && (
        <p role="alert" className={BANNER_ERROR}>
          {error.message}
          {error.details?.map((d, i) => (
            <span key={i} className="block text-xs">
              {d.path ? `${d.path}: ` : ''}
              {d.message}
            </span>
          ))}
        </p>
      )}
    </>
  );
}
