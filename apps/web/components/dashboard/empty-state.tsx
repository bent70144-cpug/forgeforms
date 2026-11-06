// Dashboard empty state (issue #3 / spec §14.1.2) — a thin wrapper around the
// shared <EmptyState> primitive (F3) so the dashboard inherits the redesigned
// .ff-empty recipe (dashed hairline, warm tint, accent icon tile) instead of
// hand-rolled markup. Copy per the redesign spec.
//
// With `onCreate` the button opens the create modal (documents CRUD is live);
// without it (pre-M2 callers) it stays disabled with a hint.
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icons';
import { BTN_PRIMARY } from '@/lib/ui';

export function DashboardEmptyState({ onCreate }: { onCreate?: () => void }) {
  const action = onCreate ? (
    <button type="button" className={BTN_PRIMARY} onClick={onCreate}>
      <Icon name="plus" size={16} />
      New document
    </button>
  ) : (
    <button
      type="button"
      className={BTN_PRIMARY}
      disabled
      title="Document creation arrives in the next milestone"
    >
      <Icon name="plus" size={16} />
      New document
    </button>
  );

  return (
    <EmptyState
      icon={<Icon name="inbox" size={20} />}
      title="No documents yet"
      description="Create your first document — start from blank or pick a template."
      action={action}
    />
  );
}
