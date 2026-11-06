'use client';

// STUB — replaced by the B7 publish-gate milestone (builder spec §7.5, §8.1).
// Contract: no props; reads doc status/validation via useBuilder() and calls
// POST /api/v1/documents/:id/publish through the transport when ready.
export function PublishControl() {
  return (
    <button type="button" className="ff-publish-btn" data-testid="publish-control-stub" disabled>
      Publish
    </button>
  );
}
