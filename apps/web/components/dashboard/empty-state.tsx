// Dashboard empty state (issue #3 / spec §14.1.2) — Meridian pass.
// Keeps the .ff-empty recipe from globals.css (dashed hairline, warm tinted
// panel, centered column) but hand-composes the illustration moment: a quiet
// line icon on a --ff-bg-2 circle (inline overrides — the shared
// .ff-empty-icon recipe still serves other callers), a Sora title and ONE
// secondary action. The page header's "New document" button stays the view's
// primary ultramarine CTA, so this one deliberately isn't.
//
// The label is deliberately "Create first document" — not the page header's
// "New document" — so exactly one button with that accessible name exists on
// an empty dashboard (the e2e helpers click it by role + name).
//
// With `onCreate` the button opens the create modal (documents CRUD is live);
// without it (pre-M2 callers) it stays disabled with a hint.
import { Icon } from '@/components/ui/icons';
import { BTN_SECONDARY } from '@/lib/ui';

export function DashboardEmptyState({ onCreate }: { onCreate?: () => void }) {
  const action = onCreate ? (
    <button type="button" className={BTN_SECONDARY} onClick={onCreate}>
      <Icon name="plus" size={16} />
      Create first document
    </button>
  ) : (
    <button
      type="button"
      className={BTN_SECONDARY}
      disabled
      title="Document creation arrives in the next milestone"
    >
      <Icon name="plus" size={16} />
      Create first document
    </button>
  );

  return (
    <section className="ff-empty">
      {/* Quiet illustration: line icon on a recessed --ff-bg-2 circle.
          Static (no ornament) — safe under prefers-reduced-motion. */}
      <div
        aria-hidden="true"
        className="ff-empty-icon mb-1"
        style={{
          width: '3.5rem',
          height: '3.5rem',
          borderRadius: '999px',
          background: 'var(--ff-bg-2)',
          color: 'var(--ff-muted)',
          boxShadow: 'inset 0 0 0 1px var(--ff-border)',
        }}
      >
        <Icon name="inbox" size={26} />
      </div>
      <h2>No documents yet</h2>
      <p className="ff-empty-description">
        Create your first document — start from blank or pick a template.
      </p>
      <div className="ff-empty-action">{action}</div>
    </section>
  );
}
