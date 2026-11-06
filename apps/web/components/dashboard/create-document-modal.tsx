'use client';

// B3 — create-document modal (spec §14.1.2): type (Form / Page / Portfolio),
// name, blank or template. Emits the created detail so the parent can refresh
// the dashboard list (or navigate into the builder).
// Errors render inline in the §4 shape (server messages + field details).
//
// The dialog chrome is the shared Modal primitive (portal to document.body,
// focus trap, Esc, scroll lock) — it mounts client-side only, so the server
// HTML of <CreateDocumentModal> is empty. The field markup lives in the
// exported, SSR-safe <CreateDocumentFields> (covered by the smoke test).
//
// ?template=<slug> handoff (template detail CTA → /dashboard): when
// `prefillTemplate` names a known template, the modal initialises with that
// type + slug on the Template tab; it re-syncs if the prop changes while
// mounted.

import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import {
  createDocument,
  DocumentsApiError,
  type DocumentDetailDto,
  type DocumentType,
} from '@/lib/documents/client';
import { Modal } from '@/components/ui/modal';
import { Icon, type IconName } from '@/components/ui/icons';
import { BANNER_ERROR, BTN_GHOST, BTN_PRIMARY, INPUT, SEG, SEG_BTN } from '@/lib/ui';

export type DashboardTemplate = {
  id: string;
  name: string;
  category: DocumentType;
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
}: {
  templates: DashboardTemplate[];
  prefillTemplate?: string;
  onClose: () => void;
  onCreated: (doc: DocumentDetailDto) => void | Promise<void>;
}) {
  const initialPrefill = resolvePrefill(templates, prefillTemplate);
  const [type, setType] = useState<DocumentType>(initialPrefill?.type ?? 'form');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<'blank' | 'template'>(initialPrefill ? 'template' : 'blank');
  const [templateId, setTemplateId] = useState<string | null>(initialPrefill?.templateId ?? null);
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
  const submitDisabled =
    submitting || title.trim().length === 0 || (start === 'template' && !effectiveTemplateId);

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
            {submitting ? 'Creating…' : 'Create document'}
          </button>
        </>
      }
    >
      {/* min-height so the panel does not jump when the Template select appears */}
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
 * The modal's fields, without dialog chrome — SSR-safe so the smoke test can
 * assert the offered types/name/start controls directly.
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
  start: 'blank' | 'template';
  onStartChange: (start: 'blank' | 'template') => void;
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
                    ? 'border-[var(--ff-accent)] bg-[color-mix(in_srgb,var(--ff-accent)_5%,var(--ff-card))] ring-2 ring-[color-mix(in_srgb,var(--ff-accent)_30%,transparent)] ring-offset-0'
                    : 'border-[var(--ff-border)] hover:border-[var(--ff-muted)]'
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
                      background: 'color-mix(in srgb, var(--ff-accent) 10%, var(--ff-card))',
                      color: 'color-mix(in srgb, var(--ff-accent) 55%, var(--ff-fg))',
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
        </div>
        {start === 'template' && (
          <div className="relative mt-2">
            <select
              aria-label="Template"
              value={effectiveTemplateId ?? ''}
              onChange={(e) => onTemplateIdChange(e.target.value || null)}
              required
              className={`${INPUT} cursor-pointer appearance-none`}
              style={{ paddingRight: '2.25rem' }}
            >
              <option value="" disabled>
                Choose a {type} template…
              </option>
              {typeTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Icon
              name="chevronDown"
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ff-muted)]"
            />
          </div>
        )}
        {start === 'template' && typeTemplates.length === 0 && (
          <p className="mt-2 text-xs text-[var(--ff-muted)]">No templates for this type yet.</p>
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
