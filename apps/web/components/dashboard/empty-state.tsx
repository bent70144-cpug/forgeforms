// Dashboard empty state (issue #3 / spec §14.1.2) — "aurora glass" pass.
// Keeps the .ff-empty recipe from globals.css (dashed violet hairline, warm
// tinted panel, centered column) but hand-composes it here so the
// illustration moment can be stronger: a soft aurora gradient halo blooming
// behind the (slightly larger) gradient icon tile, a short lead line and the
// primary CTA.
//
// The CTA label is deliberately "Create first document" — not the page
// header's "New document" — so exactly one button with that accessible name
// exists on an empty dashboard (the e2e helpers click it by role + name).
//
// With `onCreate` the button opens the create modal (documents CRUD is live);
// without it (pre-M2 callers) it stays disabled with a hint.
import { Icon } from '@/components/ui/icons';
import { BTN_PRIMARY } from '@/lib/ui';

export function DashboardEmptyState({ onCreate }: { onCreate?: () => void }) {
  const action = onCreate ? (
    <button type="button" className={BTN_PRIMARY} onClick={onCreate}>
      <Icon name="plus" size={16} />
      Create first document
    </button>
  ) : (
    <button
      type="button"
      className={BTN_PRIMARY}
      disabled
      title="Document creation arrives in the next milestone"
    >
      <Icon name="plus" size={16} />
      Create first document
    </button>
  );

  return (
    <section className="ff-empty">
      {/* Illustration moment: aurora gradient halo behind the icon tile.
          Static (no animation) — safe under prefers-reduced-motion. */}
      <div aria-hidden="true" className="relative mb-1 flex items-center justify-center">
        <span
          className="absolute h-16 w-16 rounded-[22px] opacity-50"
          style={{ background: 'var(--ff-grad)', filter: 'blur(24px)' }}
        />
        <span
          className="ff-empty-icon relative"
          style={{ width: '3.5rem', height: '3.5rem', borderRadius: '18px' }}
        >
          <Icon name="inbox" size={26} />
        </span>
      </div>
      <h2>No documents yet</h2>
      <p className="ff-empty-description">
        Create your first document — start from blank or pick a template.
      </p>
      <div className="ff-empty-action">{action}</div>
    </section>
  );
}
