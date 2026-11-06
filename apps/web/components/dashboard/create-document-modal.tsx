'use client';

// T07 — create-document modal (spec §14.1.2): type (Form / Page / Portfolio),
// name, blank or template. Emits the created detail so the parent can refresh
// the dashboard list (or navigate into the builder).
// Errors render inline in the §4 shape (server messages + field details).

import { useEffect, useRef, useState } from 'react';
import {
  createDocument,
  DocumentsApiError,
  type DocumentDetailDto,
  type DocumentType,
} from '@/lib/documents/client';

export type DashboardTemplate = {
  id: string;
  name: string;
  category: DocumentType;
};

const TYPES: { value: DocumentType; label: string; hint: string }[] = [
  { value: 'form', label: 'Form', hint: 'Conversational surveys and quizzes' },
  { value: 'page', label: 'Page', hint: 'Scroll landing page' },
  { value: 'portfolio', label: 'Portfolio', hint: 'Scroll showcase of work' },
];

// Shared button recipes — token-driven so they flip with dark mode.
const BTN_PRIMARY =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-4 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-4 text-sm font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))] disabled:cursor-not-allowed disabled:opacity-50';

export function CreateDocumentModal({
  templates,
  onClose,
  onCreated,
}: {
  templates: DashboardTemplate[];
  onClose: () => void;
  onCreated: (doc: DocumentDetailDto) => void | Promise<void>;
}) {
  const [type, setType] = useState<DocumentType>('form');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<'blank' | 'template'>('blank');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; details?: { path?: string; message: string }[] } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const typeTemplates = templates.filter((t) => t.category === type);
  // Reset the template choice when the type changes and the pick no longer fits.
  const effectiveTemplateId =
    start === 'template' && templateId && typeTemplates.some((t) => t.id === templateId)
      ? templateId
      : null;

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
        setError({ message: err.message, details: err.details as never[] | undefined });
      } else {
        setError({ message: 'Network error while creating the document.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-document-title"
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-lg rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-6 shadow-xl"
      >
        <h2 id="create-document-title" className="text-base font-semibold text-[var(--ff-fg)] text-balance">
          New document
        </h2>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-[var(--ff-fg)]">Type</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TYPES.map((t) => (
              <label
                key={t.value}
                title={t.hint}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-[calc(var(--ff-radius)*0.66)] border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ff-primary)] ${
                  type === t.value
                    ? 'border-transparent bg-[color-mix(in_srgb,var(--ff-primary)_8%,var(--ff-card))] ring-2 ring-[var(--ff-primary)]'
                    : 'border-[var(--ff-border)] hover:border-[var(--ff-muted)]'
                }`}
              >
                <input
                  type="radio"
                  name="doc-type"
                  value={t.value}
                  checked={type === t.value}
                  onChange={() => {
                    setType(t.value);
                    setTemplateId(null);
                  }}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-[var(--ff-fg)]">{t.label}</span>
                <span className="text-xs text-[var(--ff-muted)]">{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="ff-field mt-4">
          <label htmlFor="doc-title">Name</label>
          <input
            id="doc-title"
            ref={nameRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            required
            placeholder="e.g. Contact form"
            aria-invalid={error?.details?.some((d) => d.path === 'title') ?? undefined}
          />
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-[var(--ff-fg)]">Start from</legend>
          <div className="ff-seg mt-2" role="group" aria-label="Start from">
            <button type="button" aria-pressed={start === 'blank'} onClick={() => setStart('blank')}>
              Blank
            </button>
            <button
              type="button"
              aria-pressed={start === 'template'}
              onClick={() => setStart('template')}
            >
              Template
            </button>
          </div>
          {start === 'template' && (
            <div className="relative mt-2">
              <select
                aria-label="Template"
                value={effectiveTemplateId ?? ''}
                onChange={(e) => setTemplateId(e.target.value || null)}
                required
                className="w-full cursor-pointer appearance-none rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] py-2 pl-3 pr-9 text-sm text-[var(--ff-fg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ff-primary)]"
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
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ff-muted)]"
              >
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
          {start === 'template' && typeTemplates.length === 0 && (
            <p className="mt-2 text-xs text-[var(--ff-muted)]">No templates for this type yet.</p>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="ff-banner ff-banner-error mt-4">
            {error.message}
            {error.details?.map((d, i) => (
              <span key={i} className="block text-xs">
                {d.path ? `${d.path}: ` : ''}
                {d.message}
              </span>
            ))}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || title.trim().length === 0 || (start === 'template' && !effectiveTemplateId)}
            className={BTN_PRIMARY}
          >
            {submitting ? 'Creating…' : 'Create document'}
          </button>
        </div>
      </form>
    </div>
  );
}
