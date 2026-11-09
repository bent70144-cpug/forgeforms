'use client';

// B3 — dashboard documents view (spec §14.1.2) — Meridian editorial pass:
// page header (eyebrow + Sora title + live count summary with mono numerals +
// the view's single ultramarine New action), a white hairline toolbar
// (client-side title search + grid/list segmented control), white doc cards
// with quiet recessed type tiles, status / type badges and floor-pinned ghost
// quick actions, and list rows with mono meta. All data flow
// (list/duplicate/archive/copy), the persisted view toggle and the
// archive-confirm modal are unchanged from the B3 build.
//
// SPEC-NOTE (submissions count): §14.1.2 also lists a per-card submissions
// count; that aggregate belongs to the results module (T05/T15) and is not
// part of the §11 DocumentSummary yet — the old "Responses: —" placeholder is
// gone rather than shipping a dead "—" on every card.
//
// SPEC-NOTE (open target): cards/actions link to /d/{id}/results — the
// builder index route /d/{id} is not part of the app yet (was a 404).
//
// Search is a view-layer filter only (title substring, client-side): it never
// touches the documents query — the count summary always reflects the whole
// workspace, and a dedicated "no matches" state offers a one-click clear.
//
// Errors surface through the §4 shape (DocumentsApiError) in a banner;
// destructive archive is confirmed through the shared Modal primitive
// (spec §14.2).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
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
import {
  BADGE_ACCENT,
  BADGE_MUTED,
  BADGE_POSITIVE,
  BANNER_ERROR,
  BTN_DESTRUCTIVE_SM,
  BTN_GHOST_SM,
  BTN_PRIMARY,
  BTN_SECONDARY_SM,
  ICON_BTN,
  INPUT,
  SEG,
  SEG_BTN,
} from '@/lib/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { CreateDocumentModal, type DashboardTemplate } from './create-document-modal';
import { DashboardEmptyState } from './empty-state';

type ViewMode = 'grid' | 'list';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; docs: DocumentSummaryDto[] }
  | { kind: 'error'; message: string };

const VIEW_STORAGE_KEY = 'ff:dashboard:view';

// Type tile icons — safe lookup with fallback for unknown type strings.
const TYPE_TILE_ICONS: Record<string, IconName> = {
  form: 'fileText',
  page: 'file',
  portfolio: 'layers',
};

export function DocumentsView({
  templates,
  prefillTemplate,
}: {
  templates: DashboardTemplate[];
  prefillTemplate?: string;
}) {
  const [view, setView] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<DocumentSummaryDto | null>(null);
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
    setArchiveTarget(null);
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

  // View-layer search filter (title substring). The workspace summary above
  // keeps reporting the unfiltered totals.
  const q = query.trim().toLowerCase();
  const shownDocs = docs && q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  const visibleDocs = shownDocs ?? [];
  const noMatches = docs !== null && docs.length > 0 && visibleDocs.length === 0;
  const publishedCount = docs?.filter((d) => d.status === 'published').length ?? 0;

  return (
    <section aria-label="Documents">
      {/* ── Page header — eyebrow, Sora title (global h1 font), live count
          summary in mono numerals, the view's ONE primary action ──────── */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="m-0 mb-1.5 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--ff-muted)]">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-[2px]"
              style={{ background: 'var(--ff-primary)' }}
            />
            Workspace
          </p>
          {/* Sora display heading — global h1 font + this clamp keeps it
              quieter than the previous design's hero-scale type */}
          <h1
            className="m-0 font-semibold leading-[1.15] tracking-[-0.02em]"
            style={{ fontSize: 'clamp(1.5rem, 3vw, 1.875rem)' }}
          >
            Documents
          </h1>
          <p className="m-0 mt-1.5 text-sm text-[var(--ff-muted)]">
            {state.kind === 'ready' && docs ? (
              <>
                {/* mono numerals — quiet stats strip, tabular so counts don't
                    shift while the workspace grows */}
                <span
                  className="font-semibold tabular-nums text-[var(--ff-fg)]"
                  style={{ fontFamily: 'var(--ff-font-mono)' }}
                >
                  {docs.length}
                </span>{' '}
                {docs.length === 1 ? 'document' : 'documents'}
                {publishedCount > 0 && (
                  <>
                    {' · '}
                    <span
                      className="font-medium tabular-nums text-[var(--ff-success)]"
                      style={{ fontFamily: 'var(--ff-font-mono)' }}
                    >
                      {publishedCount}
                    </span>{' '}
                    published
                  </>
                )}
              </>
            ) : state.kind === 'loading' ? (
              'Loading documents…'
            ) : null}
          </p>
        </div>
        <button
          type="button"
          className={`${BTN_PRIMARY} w-full sm:w-auto`}
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={16} />
          New document
        </button>
      </header>

      {/* ── Toolbar — search + layout toggle on a white hairline card.
          Wraps cleanly on mobile: search takes its own row, the toggle
          rides right below it. ───────────────────────────────────────── */}
      <div
        className="ff-toolbar"
        style={{
          background: 'var(--ff-card)',
          border: '1px solid var(--ff-border)',
          borderRadius: 'var(--ff-radius)',
          padding: '0.625rem 0.75rem',
          boxShadow: 'var(--ff-shadow-sm)',
        }}
      >
        <div className="relative w-full min-w-0 sm:max-w-xs">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ff-muted)]"
          />
          <input
            type="search"
            className={`${INPUT} pl-9! [&::-webkit-search-cancel-button]:hidden`}
            placeholder="Search documents…"
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <div className={SEG} role="group" aria-label="Layout">
            <button
              type="button"
              className={SEG_BTN}
              aria-pressed={view === 'grid'}
              aria-label="Grid view"
              onClick={() => switchView('grid')}
            >
              <Icon name="grid" size={14} />
              <span className="hidden sm:inline">Grid</span>
            </button>
            <button
              type="button"
              className={SEG_BTN}
              aria-pressed={view === 'list'}
              aria-label="List view"
              onClick={() => switchView('list')}
            >
              <Icon name="list" size={14} />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>
        </div>
      </div>

      {banner && (
        <p role="alert" className={`${BANNER_ERROR} mb-4 break-all`}>
          {banner}
        </p>
      )}

      {state.kind === 'loading' && (
        <div aria-hidden className="ff-doc-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="ff-skeleton" style={{ height: '10rem' }} />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div className={BANNER_ERROR}>
          <p className="font-medium">Documents could not be loaded.</p>
          <p className="mt-1">{state.message}</p>
          <button type="button" onClick={() => void load()} className={`${BTN_SECONDARY_SM} mt-3`}>
            Retry
          </button>
        </div>
      )}

      {docs && docs.length === 0 && <DashboardEmptyState onCreate={() => setCreating(true)} />}

      {/* search narrowed the workspace to zero — distinct from the true
          empty workspace above, with a one-click reset */}
      {noMatches && (
        <div className="ff-empty ff-empty--compact">
          {/* inline overrides quiet the shared .ff-empty-icon recipe (still
              gradient-backed for other callers) to the Meridian circle */}
          <div
            className="ff-empty-icon"
            aria-hidden="true"
            style={{
              background: 'var(--ff-bg-2)',
              color: 'var(--ff-muted)',
              boxShadow: 'inset 0 0 0 1px var(--ff-border)',
              borderRadius: '999px',
            }}
          >
            <Icon name="search" size={18} />
          </div>
          <h2>No documents match “{query.trim()}”</h2>
          <p className="ff-empty-description">
            Search matches document titles. Try a different name or clear the filter.
          </p>
          <div className="ff-empty-action">
            <button type="button" className={BTN_SECONDARY_SM} onClick={() => setQuery('')}>
              Clear search
            </button>
          </div>
        </div>
      )}

      {docs && docs.length > 0 && !noMatches && view === 'grid' && (
        <ul className="ff-doc-grid">
          {visibleDocs.map((doc) => (
            <li key={doc.id} className="ff-doc-card group relative">
              {/* Row 1 — gradient type tile + stretched title link + badges.
                  The title's ::after covers the card, so the whole card is
                  clickable; interactive children sit above it (z-10). */}
              <div className="flex items-center gap-3">
                <TypeTile type={doc.type} />
                <Link
                  href={`/d/${doc.id}/results`}
                  className="ff-doc-title min-w-0 flex-1 tracking-[-0.01em] after:absolute after:inset-0"
                  style={{ fontFamily: 'var(--ff-font-heading)' }}
                >
                  {doc.title}
                </Link>
                <div className="relative z-10 flex shrink-0 items-center gap-1.5">
                  <span className={doc.status === 'published' ? BADGE_POSITIVE : BADGE_MUTED}>
                    {documentStatusBadge(doc.status)}
                  </span>
                  <span className={BADGE_ACCENT}>{documentTypeBadge(doc.type)}</span>
                </div>
              </div>
              {/* Row 2 — mono meta (dates/ids render in the mono family) */}
              <p
                className="m-0 text-xs tabular-nums text-[var(--ff-muted)]"
                style={{ fontFamily: 'var(--ff-font-mono)' }}
              >
                Updated {relativeUpdatedAt(doc.updatedAt)}
              </p>
              {/* Row 3 — quick actions, pinned to the card floor; dimmed
                  until hover/focus (always full-strength on touch widths) */}
              <DocumentActions
                doc={doc}
                busyId={busyId}
                copiedId={copiedId}
                onDuplicate={() => void duplicate(doc)}
                onArchive={() => setArchiveTarget(doc)}
                onCopyLink={() => void copyLink(doc)}
              />
            </li>
          ))}
        </ul>
      )}

      {docs && docs.length > 0 && !noMatches && view === 'list' && (
        <ul className="ff-doc-list divide-y divide-[var(--ff-border)]">
          {visibleDocs.map((doc) => (
            <li
              key={doc.id}
              className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--ff-primary)_5%,transparent)]"
            >
              <TypeTile type={doc.type} />
              <div className="min-w-0">
                <Link
                  href={`/d/${doc.id}/results`}
                  className="ff-doc-title block truncate text-[15px] font-semibold tracking-[-0.01em] transition-colors after:absolute after:inset-0 hover:text-[var(--ff-accent-soft)]"
                  style={{ fontFamily: 'var(--ff-font-heading)' }}
                >
                  {doc.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={doc.status === 'published' ? BADGE_POSITIVE : BADGE_MUTED}>
                    {documentStatusBadge(doc.status)}
                  </span>
                  <span className={BADGE_ACCENT}>{documentTypeBadge(doc.type)}</span>
                  <span
                    className="text-xs tabular-nums text-[var(--ff-muted)]"
                    style={{ fontFamily: 'var(--ff-font-mono)' }}
                  >
                    Updated {relativeUpdatedAt(doc.updatedAt)}
                  </span>
                </div>
              </div>
              <DocumentActions
                doc={doc}
                busyId={busyId}
                copiedId={copiedId}
                iconOnly
                onDuplicate={() => void duplicate(doc)}
                onArchive={() => setArchiveTarget(doc)}
                onCopyLink={() => void copyLink(doc)}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateDocumentModal
          templates={templates}
          prefillTemplate={prefillTemplate}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}

      <Modal
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        title="Archive document?"
        description={
          archiveTarget
            ? `"${archiveTarget.title}" will disappear from the builder and API lists.`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              className={BTN_GHOST_SM}
              onClick={() => setArchiveTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={BTN_DESTRUCTIVE_SM}
              disabled={archiveTarget !== null && busyId === archiveTarget.id}
              onClick={() => {
                if (archiveTarget) void archive(archiveTarget);
              }}
            >
              Archive
            </button>
          </>
        }
      />
    </section>
  );
}

/**
 * 36px recessed type tile — the Meridian recipe: the paper well (--ff-bg-2)
 * with a 1px hairline ring and a muted stroke icon. Tokens only, so the
 * night scheme flips automatically.
 */
function TypeTile({ type }: { type: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
      style={{
        background: 'var(--ff-bg-2)',
        boxShadow: 'inset 0 0 0 1px var(--ff-border)',
        color: 'var(--ff-muted)',
      }}
    >
      <Icon name={TYPE_TILE_ICONS[type] ?? 'file'} size={18} />
    </span>
  );
}

/**
 * §14.1.2 quick actions: open results, copy link, duplicate, archive.
 * Grid cards use a ghost "Open" + ghost icon actions above a hairline separator;
 * list rows are icon-only. `relative z-10` keeps the buttons above the card's
 * stretched title link. The grid wrapper carries `group`-driven opacity so
 * the row brightens on card hover/focus without hiding controls from touch.
 */
function DocumentActions({
  doc,
  busyId,
  copiedId,
  iconOnly = false,
  onDuplicate,
  onArchive,
  onCopyLink,
}: {
  doc: DocumentSummaryDto;
  busyId: string | null;
  copiedId: string | null;
  iconOnly?: boolean;
  onDuplicate: () => void;
  onArchive: () => void;
  onCopyLink: () => void;
}): ReactNode {
  const busy = busyId === doc.id;
  const copied = copiedId === doc.id;
  const openHref = `/d/${doc.id}/results`;

  if (iconOnly) {
    return (
      // max-sm: the 40px icon row (4 actions ≈ 172px) would squeeze the title
      // to a sliver on phones — drop it to its own full-width, right-aligned
      // grid row instead. Desktop keeps the single-line row.
      <div className="relative z-10 flex shrink-0 items-center gap-1 max-sm:col-span-3 max-sm:justify-end">
        <Link
          href={openHref}
          className={ICON_BTN}
          title={`Open "${doc.title}" results`}
          aria-label={`Open "${doc.title}" results`}
        >
          <Icon name="external" size={16} />
        </Link>
        <button
          type="button"
          className={`${ICON_BTN}${copied ? ' text-[var(--ff-success)]!' : ''}`}
          title={`Copy public link (${doc.slug}) — works once the document is published`}
          aria-label="Copy public link"
          onClick={onCopyLink}
        >
          <Icon name={copied ? 'check' : 'link'} size={16} />
        </button>
        <button
          type="button"
          className={ICON_BTN}
          title="Duplicate"
          aria-label="Duplicate"
          aria-busy={busy}
          disabled={busy}
          onClick={onDuplicate}
        >
          <Icon name={busy ? 'spinner' : 'copy'} size={16} />
        </button>
        <button
          type="button"
          className={`${ICON_BTN} hover:text-[var(--ff-danger)]!`}
          title="Archive"
          aria-label="Archive"
          disabled={busy}
          onClick={onArchive}
        >
          <Icon name="archive" size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="ff-doc-actions relative z-10 border-t border-[var(--ff-border)] pt-2.5 opacity-75 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
      <Link href={openHref} className={BTN_GHOST_SM}>
        Open
      </Link>
      <button
        type="button"
        className={`${ICON_BTN} p-0!${copied ? ' text-[var(--ff-success)]!' : ''}`}
        title={`Copy public link (${doc.slug}) — works once the document is published`}
        aria-label="Copy public link"
        onClick={onCopyLink}
      >
        <Icon name={copied ? 'check' : 'link'} size={16} />
      </button>
      <button
        type="button"
        className={`${ICON_BTN} p-0!`}
        title="Duplicate"
        aria-label="Duplicate"
        aria-busy={busy}
        disabled={busy}
        onClick={onDuplicate}
      >
        <Icon name={busy ? 'spinner' : 'copy'} size={16} />
      </button>
      {/* hairline separator before the destructive action */}
      <span aria-hidden="true" className="h-4 w-px p-0!" style={{ background: 'var(--ff-border)' }} />
      <button
        type="button"
        className={`${ICON_BTN} p-0! hover:text-[var(--ff-danger)]!`}
        title="Archive"
        aria-label="Archive"
        disabled={busy}
        onClick={onArchive}
      >
        <Icon name="archive" size={16} />
      </button>
    </div>
  );
}
