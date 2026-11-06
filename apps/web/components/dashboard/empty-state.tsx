// Dashboard empty state (issue #3 / spec §14.1.2): exact copy
// "No documents yet — create your first"; actionable per spec §14.2.
// T07: with `onCreate` the button opens the create modal (documents CRUD is
// live); without it (pre-M2 callers) it stays disabled with a hint.
export function DashboardEmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <section aria-labelledby="dashboard-empty-title" className="ff-empty">
      <h1 id="dashboard-empty-title">No documents yet — create your first</h1>
      <p className="ff-subtle">Forms, landing pages and portfolios all live here.</p>
      {onCreate ? (
        <button type="button" className="ff-button ff-button-primary" onClick={onCreate}>
          New document
        </button>
      ) : (
        <button
          type="button"
          className="ff-button ff-button-primary"
          disabled
          title="Document creation arrives in the next milestone"
        >
          New document
        </button>
      )}
    </section>
  );
}
