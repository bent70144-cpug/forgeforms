// Dashboard empty state (issue #3 / spec §14.1.2): exact copy
// "No documents yet — create your first"; actionable per spec §14.2.
// T07: with `onCreate` the button opens the create modal (documents CRUD is
// live); without it (pre-M2 callers) it stays disabled with a hint.
export function DashboardEmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <section aria-labelledby="dashboard-empty-title" className="ff-empty">
      <h1 id="dashboard-empty-title" className="text-balance">
        No documents yet — create your first
      </h1>
      <p className="ff-subtle max-w-sm leading-relaxed">
        Forms, landing pages and portfolios all live here.
      </p>
      {onCreate ? (
        <button
          type="button"
          className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-4 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onCreate}
        >
          New document
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-4 text-sm font-medium text-[var(--ff-primary-fg)] opacity-50"
          disabled
          title="Document creation arrives in the next milestone"
        >
          New document
        </button>
      )}
    </section>
  );
}
