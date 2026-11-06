'use client';

// STUB — replaced by the B3 canvas milestone (builder spec §5).
// Contract: no props; reads the builder store via useBuilder().
export function Canvas() {
  return (
    <div className="ff-canvas" data-testid="canvas-stub" aria-label="Form editor">
      <p style={{ color: "#64748b", padding: 24 }}>Canvas placeholder</p>
    </div>
  );
}
