// T07 — pure display helpers for the dashboard document cards (spec §14.1.2).
// Framework-free and DOM-free so they unit-test without a browser.

export type DocumentType = 'form' | 'page' | 'portfolio';
export type DocumentStatus = 'draft' | 'published' | 'archived';

/** §14.1.2 card badge for the document type. */
export function documentTypeBadge(type: DocumentType): string {
  switch (type) {
    case 'form':
      return 'Form';
    case 'page':
      return 'Page';
    case 'portfolio':
      return 'Portfolio';
    default: {
      const exhaustive: never = type;
      return String(exhaustive);
    }
  }
}

/** §14.1.2 card badge for the lifecycle status. */
export function documentStatusBadge(status: DocumentStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'published':
      return 'Published';
    case 'archived':
      return 'Archived';
    default: {
      const exhaustive: never = status;
      return String(exhaustive);
    }
  }
}

/** Tailwind-ish modifier appended to `ff-badge ff-badge--…` (see globals.css). */
export function documentStatusTone(status: DocumentStatus): string {
  switch (status) {
    case 'draft':
      return 'neutral';
    case 'published':
      return 'positive';
    case 'archived':
      return 'muted';
    default: {
      const exhaustive: never = status;
      return String(exhaustive);
    }
  }
}

/**
 * Relative "updated" time for card subtitles (spec §14.1.2 "updated time").
 * Deterministic given `now` — tests assert exact strings.
 */
export function relativeUpdatedAt(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diffMs = Math.max(0, now.getTime() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Public share link for a document (works once it is published). */
export function publicShareUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}/p/${encodeURIComponent(slug)}`;
}
