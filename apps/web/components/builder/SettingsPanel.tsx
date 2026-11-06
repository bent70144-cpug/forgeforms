'use client';

// Right-pane settings panel (builder spec §6.6): routes on the store state —
// a selected block shows BlockSettings (Content / Behavior / Logic /
// Advanced), anything else shows the Document settings tabs. Theme and
// Endings have their own panels (BuilderShell routes `panel` before us).
//
// `initialTab` is a test seam (renderToStaticMarkup never runs effects, so
// the tab's internal useState is seeded from props); production passes
// nothing and lands on "general".

import { useBuilder } from "./context";
import { BlockSettings } from "./settings/BlockSettings";
import { DocSettings, type DocSettingsTab } from "./settings/DocSettings";

export type { DocSettingsTab } from "./settings/DocSettings";

export function SettingsPanel({ initialTab }: { initialTab?: DocSettingsTab }) {
  const { state } = useBuilder();
  const showBlock =
    state.panel === "block" && state.selection !== null;

  return (
    <div className="ff-set-panel" data-testid="settings-panel">
      {showBlock ? <BlockSettings /> : <DocSettings initialTab={initialTab} />}
    </div>
  );
}
