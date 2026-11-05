// Dashboard empty state (issue #3 / spec §14.1.2): exact copy
// "No documents yet — create your first"; actionable per spec §14.2.
// SPEC-NOTE: the create modal + document CRUD ship with M2 (documents); the
// "New document" button is rendered disabled so the layout is final.
export function DashboardEmptyState() {
  return (
    <section aria-labelledby="dashboard-empty-title" className="ff-empty">
      <h1 id="dashboard-empty-title">No documents yet — create your first</h1>
      <p className="ff-subtle">Forms, landing pages and portfolios all live here.</p>
      <button
        type="button"
        className="ff-button ff-button-primary"
        disabled
        title="Document creation arrives in the next milestone"
      >
        New document
      </button>
    </section>
  );
}
