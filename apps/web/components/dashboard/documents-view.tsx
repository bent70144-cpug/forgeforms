'use client';

// T07 — dashboard documents view (spec §14.1.2): grid/list toggle, cards with
// title + type badge + status + updated time, quick actions (open, copy link,
// duplicate, archive), "New" → create modal (type + name + blank/template).
//
// SPEC-NOTE (submissions count): §14.1.2 also lists a per-card submissions
// count; that aggregate belongs to the results module (T05/T15) and is not
// part of the §11 DocumentSummary yet — cards show "—" until it lands.
//
// Errors surface through the §4 shape (DocumentsApiError) in a banner;
// destructive archive uses a confirm dialog (spec §14.2).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  archiveDocument,
  DocumentsApiError,
  duplicateDocument,
  listDocuments,
  type DocumentSummaryDto,
} from '@/lib/documents/client';
import {
  documentStatusBadge,
  documentTypeBadge,
  publicShareUrl,
  relativeUpdatedAt,
} from '@/lib/documents/format';
import { CreateDocumentModal, type DashboardTemplate } from './create-document-modal';
import { DashboardEmptyState } from './empty-state';

type ViewMode = 'grid' | 'list';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; docs: DocumentSummaryDto[] }
  | { kind: 'error'; message: string };

const VIEW_STORAGE_KEY = 'ff:dashboard:view';

// Shared button recipes — token-driven so they flip with dark mode.
const BTN_PRIMARY =
  'inline-flex h-9 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-3.5 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
// Small row-action variants (height h-8; .ff-doc-actions tightens the padding).
const BTN_SECONDARY_SM =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-2.5 text-xs font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_DESTRUCTIVE_SM =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-red-300/50 bg-[var(--ff-card)] px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/30 dark:text-red-400';

export function DocumentsView({ templates }: { templates: DashboardTemplate[] }) {
  const [view, setView] = useState<ViewMode>('grid');
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const page = await listDocuments();
      setState({ kind: 'ready', docs: page.data });
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof DocumentsApiError ? err.message : 'Network error while loading documents.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Restore the persisted view toggle once on the client (SSR default: grid).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'grid' || stored === 'list') setView(stored);
  }, []);

  const switchView = (mode: ViewMode) => {
    setView(mode);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      // private mode — the toggle still works, just is not persisted
    }
  };

  const duplicate = async (doc: DocumentSummaryDto) => {
    setBusyId(doc.id);
    setBanner(null);
    try {
      await duplicateDocument(doc.id);
      await load();
    } catch (err) {
      setBanner(err instanceof DocumentsApiError ? err.message : 'Could not duplicate the document.');
    } finally {
      setBusyId(null);
    }
  };

  const archive = async (doc: DocumentSummaryDto) => {
    if (!window.confirm(`Archive "${doc.title}"? It will disappear from the builder and API lists.`)) {
      return;
    }
    setBusyId(doc.id);
    setBanner(null);
    try {
      await archiveDocument(doc.id);
      await load();
    } catch (err) {
      setBanner(err instanceof DocumentsApiError ? err.message : 'Could not archive the document.');
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async (doc: DocumentSummaryDto) => {
    const url = publicShareUrl(window.location.origin, doc.slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(doc.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === doc.id ? null : cur)), 2000);
    } catch {
      setBanner(url); // clipboard blocked — show the URL so it can be copied manually
    }
  };

  const docs = state.kind === 'ready' ? state.docs : null;

  return (
    <section aria-label="Documents">
      <div className="ff-toolbar flex-wrap gap-y-2">
        <h1 className="m-0 text-lg font-semibold text-balance">Documents</h1>
        <div className="ff-seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => switchView('grid')}>
            Grid
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => switchView('list')}>
            List
          </button>
        </div>
        <div className="ml-auto">
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => setCreating(true)}
          >
            New document
          </button>
        </div>
      </div>

      {banner && (
        <p role="alert" className="ff-banner ff-banner-error mb-4 break-all">
          {banner}
        </p>
      )}

      {state.kind === 'loading' && (
        <div aria-hidden className="ff-doc-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ff-skeleton" />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div className="ff-banner ff-banner-error">
          <p className="font-medium">Documents could not be loaded.</p>
          <p className="mt-1">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex h-8 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-current/40 bg-transparent px-2.5 text-xs font-medium text-[var(--ff-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)]"
          >
            Retry
          </button>
        </div>
      )}

      {docs && docs.length === 0 && <DashboardEmptyState onCreate={() => setCreating(true)} />}

      {docs && docs.length > 0 && view === 'grid' && (
        <ul className="ff-doc-grid" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="ff-doc-card transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md"
            >
              <a href={`/d/${doc.id}`} className="ff-doc-title">
                {doc.title}
              </a>
              <DocumentMeta doc={doc} />
              <DocumentActions
                doc={doc}
                busyId={busyId}
                copiedId={copiedId}
                onDuplicate={() => void duplicate(doc)}
                onArchive={() => void archive(doc)}
                onCopyLink={() => void copyLink(doc)}
              />
            </li>
          ))}
        </ul>
      )}

      {docs && docs.length > 0 && view === 'list' && (
        <ul className="ff-doc-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {docs.map((doc) => (
            <li key={doc.id} className="ff-doc-row">
              <a href={`/d/${doc.id}`} className="ff-doc-title" style={{ minWidth: 0, flex: 1 }}>
                {doc.title}
              </a>
              <DocumentMeta doc={doc} compact />
              <DocumentActions
                doc={doc}
                busyId={busyId}
                copiedId={copiedId}
                onDuplicate={() => void duplicate(doc)}
                onArchive={() => void archive(doc)}
                onCopyLink={() => void copyLink(doc)}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateDocumentModal
          templates={templates}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
    </section>
  );
}

/** Type + status badges, updated time (and the pending submissions count). */
function DocumentMeta({ doc, compact = false }: { doc: DocumentSummaryDto; compact?: boolean }) {
  return (
    <div className="ff-doc-meta tabular-nums">
      <span className="ff-badge ff-badge--accent">{documentTypeBadge(doc.type)}</span>
      <span
        className={`ff-badge ${doc.status === 'published' ? 'ff-badge--positive' : 'ff-badge--muted'}`}
      >
        {documentStatusBadge(doc.status)}
      </span>
      {!compact && (
        <span className="ff-doc-subtle" title="Submissions count arrives with the results module">
          Responses: —
        </span>
      )}
      <span className="ff-doc-subtle">Updated {relativeUpdatedAt(doc.updatedAt)}</span>
    </div>
  );
}

/** §14.1.2 quick actions: open, copy link, duplicate, archive. */
function DocumentActions({
  doc,
  busyId,
  copiedId,
  onDuplicate,
  onArchive,
  onCopyLink,
}: {
  doc: DocumentSummaryDto;
  busyId: string | null;
  copiedId: string | null;
  onDuplicate: () => void;
  onArchive: () => void;
  onCopyLink: () => void;
}): ReactNode {
  const busy = busyId === doc.id;
  return (
    <div className="ff-doc-actions">
      <a href={`/d/${doc.id}`} className={BTN_SECONDARY_SM}>
        Open
      </a>
      <button
        type="button"
        className={BTN_SECONDARY_SM}
        title={`Copy public link (${doc.slug}) — works once the document is published`}
        onClick={onCopyLink}
      >
        {copiedId === doc.id ? 'Copied!' : 'Link'}
      </button>
      <button
        type="button"
        className={BTN_SECONDARY_SM}
        disabled={busy}
        onClick={onDuplicate}
      >
        {busy ? 'Working…' : 'Duplicate'}
      </button>
      <button
        type="button"
        className={BTN_DESTRUCTIVE_SM}
        disabled={busy}
        onClick={onArchive}
      >
        Archive
      </button>
    </div>
  );
}
