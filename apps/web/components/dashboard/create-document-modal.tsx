'use client';

// T07/B8 — create-document modal (spec §11 + §14.1.2): type (Form / Page /
// Portfolio), name, and a segmented start choice "Blank | Template |
// Generate with AI".
//
// §11 template gallery (in-modal): the Template segment lists the workspace
// catalog (name + category chip + stats) as a radio list; the primary button
// becomes "Use template" and the submit POSTs `{ type, title, templateId }`
// (the API instantiates the template server-side — fresh ids, copied body).
//
// §24 entitlement gate: "Generate with AI" renders as a DISABLED segment with
// an inline "Pro" badge + note — upgrade modals are forbidden; entitlement
// resolution is server-side (`can()`), so the badge is static here. The live
// AI flow lives in the AI workbench (`d/[docId]/ai`).
//
// §11 AI group + §15 telemetry: applying AI results is grouped/undoable in
// the builder (lib/builder/ai-apply.ts); this modal tracks "template_used".
//
// Emits the created detail so the parent can refresh the dashboard list (or
// navigate into the builder). Errors render inline in the §4 shape (server
// messages + field details).

import { useEffect, useRef, useState } from 'react';
import {
  createDocument,
  DocumentsApiError,
  type DocumentDetailDto,
  type DocumentType,
} from '@/lib/documents/client';
import { track } from '@/lib/telemetry';

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

const TYPES: { value: DocumentType; label: string; hint: string }[] = [
  { value: 'form', label: 'Form', hint: 'Conversational surveys and quizzes' },
  { value: 'page', label: 'Page', hint: 'Scroll landing page' },
  { value: 'portfolio', label: 'Portfolio', hint: 'Scroll showcase of work' },
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

// Shared button recipes — token-driven so they flip with dark mode.
const BTN_PRIMARY =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-4 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-4 text-sm font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))] disabled:cursor-not-allowed disabled:opacity-50';

export function CreateDocumentModal({
  templates,
  onClose,
  onCreated,
  initialStart = 'blank',
  initialTemplateId = null,
}: {
  templates: DashboardTemplate[];
  onClose: () => void;
  onCreated: (doc: DocumentDetailDto) => void | Promise<void>;
  /** Initial segment (deep-link/test hook; users start on Blank). */
  initialStart?: StartMode;
  /** Initial template pick (pairs with initialStart="template"). */
  initialTemplateId?: string | null;
}) {
  const [type, setType] = useState<DocumentType>('form');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<StartMode>(initialStart);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; details?: { path?: string; message: string }[] } | null>(null);
  const firstControlRef = useRef<HTMLInputElement>(null);
  const dialogFormRef = useRef<HTMLFormElement>(null);

  // §12 focus management: opening the dialog focuses its first control.
  useEffect(() => {
    firstControlRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus trap-ish: Tab wraps inside the dialog (§12).
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogFormRef.current) return;
    const focusables = dialogFormRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href]',
    );
    if (focusables.length === 0) return;
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !(active instanceof Node) || !dialogFormRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const typeTemplates = templates.filter((t) => t.category === type);
  // Reset the template choice when the type changes and the pick no longer fits.
  const effectiveTemplateId =
    start === 'template' && templateId && typeTemplates.some((t) => t.id === templateId)
      ? templateId
      : null;
  const hasTemplate = effectiveTemplateId !== null;

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
      onKeyDown={trapTab}
    >
      <form
        ref={dialogFormRef}
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
            {TYPES.map((t, i) => (
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
                  ref={i === 0 ? firstControlRef : undefined}
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
          {/* §11 segmented choice: Blank | Template | Generate with AI. The
              AI segment is the §24 gated control: disabled + inline Pro badge
              (never a modal), its flow lives in the AI workbench. */}
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
            <button type="button" disabled className="ff-tpl-ai" title="AI drafting is available on Pro">
              Generate with AI <span className="ff-tpl-pro">Pro</span>
            </button>
          </div>
          <p className="ff-tpl-note">AI drafting is available on Pro.</p>

          {/* §11 gallery: radio list (name + category chip + stats). Rendered
              (hidden) even before the segment is picked so screen readers get
              a stable DOM and the choice survives segment toggling. */}
          <div
            className="ff-tpl-list"
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
                    onChange={() => setTemplateId(t.id)}
                    className="ff-tpl-radio"
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
            {createSubmitLabel({ submitting, hasTemplate })}
          </button>
        </div>
      </form>
    </div>
  );
}
