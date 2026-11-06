'use client';

// STUB — replaced by the B5 settings-panel milestone (builder spec §6.6, §9).
// Contract: no props; reads the selected block / panel tab via useBuilder().
export function SettingsPanel() {
  return (
    <div className="ff-settings-panel" data-testid="settings-panel-stub">
      <p style={{ color: "#64748b", padding: 16 }}>Settings panel placeholder</p>
    </div>
  );
}
