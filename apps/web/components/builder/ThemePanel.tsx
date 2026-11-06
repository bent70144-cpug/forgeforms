'use client';

// STUB — replaced by the B6 theme milestone (builder spec §8.2, §23).
// Contract: no props; reads/writes theme via useBuilder() + theme.update ops.
export function ThemePanel() {
  return (
    <div className="ff-theme-panel" data-testid="theme-panel-stub">
      <p style={{ color: "#64748b", padding: 16 }}>Theme panel placeholder</p>
    </div>
  );
}
