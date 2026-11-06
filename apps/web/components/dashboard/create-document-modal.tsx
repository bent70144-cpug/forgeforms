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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-document-title"
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="create-document-title" className="text-base font-semibold text-slate-900">
          New document
        </h2>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700">Type</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <label
                key={t.value}
                title={t.hint}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                style={
                  type === t.value
                    ? { borderColor: 'var(--ff-primary)', color: 'var(--ff-primary)' }
                    : { borderColor: 'var(--ff-border)' }
                }
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
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="doc-title" className="mt-4 block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="doc-title"
          ref={nameRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          required
          placeholder="e.g. Contact form"
          aria-invalid={error?.details?.some((d) => d.path === 'title') ?? undefined}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700">Start from</legend>
          <div className="mt-2 flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="doc-start"
                checked={start === 'blank'}
                onChange={() => setStart('blank')}
              />
              Blank
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="doc-start"
                checked={start === 'template'}
                onChange={() => setStart('template')}
              />
              Template
            </label>
          </div>
          {start === 'template' && (
            <select
              aria-label="Template"
              value={effectiveTemplateId ?? ''}
              onChange={(e) => setTemplateId(e.target.value || null)}
              required
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
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
          )}
          {start === 'template' && typeTemplates.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">No templates for this type yet.</p>
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
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || title.trim().length === 0 || (start === 'template' && !effectiveTemplateId)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create document'}
          </button>
        </div>
      </form>
    </div>
  );
}
