'use client';

// Three-pane builder shell (spec §4):
//   ≥1200px  three panes — left tree 272px / canvas / settings 320px
//   768–1199 left pane collapses to a 56px icon rail (full tree opens as an
//            overlay); the right pane is a slide-over drawer toggled from the
//            TopBar ⚙ button
//   <768px   single column (canvas only); panes become ~70vh bottom sheets
//            behind a "Blocks / Settings" bottom bar
// SPEC-DEVIATION: thresholds are enforced in JS (matchMedia 768/1200) instead
// of Tailwind responsive prefixes because the spec's 1200px cut sits between
// Tailwind's lg (1024) and xl (1280). SSR/prerender renders the desktop zone;
// the client corrects after mount (no hydration mismatch — first client
// render is also "desktop").
// Landmarks (§12): header banner, complementary panes (aside), main labelled
// "Form editor". Overlays are modal dialogs and return focus to their
// invoking control on close.

import { useCallback, useEffect, useRef, useState } from "react";
import { useBuilder } from "./context";
import { ContextualBanner, type BannerKind } from "./ContextualBanner";
import { LeftPane } from "./LeftPane";
import { TopBar } from "./TopBar";
import { Canvas } from "./Canvas";
import { EndingsPanel } from "./EndingsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ThemePanel } from "./ThemePanel";
import { UndoToast } from "./UndoToast";
import type { SaveStatusStore } from "./save-indicator";

type Zone = "mobile" | "tablet" | "desktop";

const TABLET_MIN_PX = 768; // md
const DESKTOP_MIN_PX = 1200; // spec §4

function useViewportZone(): Zone {
  const [zone, setZone] = useState<Zone>("desktop");
  useEffect(() => {
    const tablet = window.matchMedia(`(min-width: ${TABLET_MIN_PX}px)`);
    const desktop = window.matchMedia(`(min-width: ${DESKTOP_MIN_PX}px)`);
    const update = () => setZone(desktop.matches ? "desktop" : tablet.matches ? "tablet" : "mobile");
    update();
    desktop.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      desktop.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);
  return zone;
}

export function BuilderShell({
  saveStatusStore,
  bannerKind = "none",
  onRestore,
}: {
  saveStatusStore: SaveStatusStore;
  bannerKind?: BannerKind;
  onRestore?: () => void;
}) {
  const { state } = useBuilder();
  const zone = useViewportZone();

  const [railExpanded, setRailExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheet, setSheet] = useState<"blocks" | "settings" | null>(null);

  // Focus restore targets for the overlay-opening controls (§12).
  const railButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsToggleRef = useRef<HTMLButtonElement | null>(null);
  const blocksSheetButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsSheetButtonRef = useRef<HTMLButtonElement | null>(null);

  // Right pane content by store panel tab (spec §4): "block" and "document"
  // share the settings panel; theme and endings have their own panels.
  const rightPane =
    state.panel === "theme" ? (
      <ThemePanel />
    ) : state.panel === "endings" ? (
      <EndingsPanel />
    ) : (
      <SettingsPanel />
    );

  const closeOverlays = useCallback(() => {
    if (railExpanded) {
      setRailExpanded(false);
      railButtonRef.current?.focus();
    } else if (settingsOpen) {
      setSettingsOpen(false);
      settingsToggleRef.current?.focus();
    } else if (sheet === "blocks") {
      setSheet(null);
      blocksSheetButtonRef.current?.focus();
    } else if (sheet === "settings") {
      setSheet(null);
      settingsSheetButtonRef.current?.focus();
    }
  }, [railExpanded, settingsOpen, sheet]);

  // Esc closes whatever overlay is open.
  useEffect(() => {
    if (!railExpanded && !settingsOpen && sheet === null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeOverlays();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railExpanded, settingsOpen, sheet, closeOverlays]);

  // Overlays never survive a zone switch.
  useEffect(() => {
    setRailExpanded(false);
    setSettingsOpen(false);
    setSheet(null);
  }, [zone]);

  const overlayHeader = (title: string, closeLabel: string) => (
    <div className="ff-pane--bottom flex items-center justify-between px-3 py-2">
      <span className="text-sm font-semibold">{title}</span>
      <button type="button" className="ff-icon-btn" aria-label={closeLabel} onClick={closeOverlays}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );

  return (
    <div className="ff-builder" data-testid="builder-shell">
      <header className="ff-pane ff-pane--bottom shrink-0">
        <TopBar
          saveStatusStore={saveStatusStore}
          onToggleSettings={zone === "tablet" ? () => setSettingsOpen(true) : undefined}
          settingsOpen={settingsOpen}
          settingsToggleRef={settingsToggleRef}
        />
      </header>

      <ContextualBanner kind={bannerKind} onRestore={onRestore} />

      <div className="flex min-h-0 flex-1">
        {/* --- left: blocks ---------------------------------------------------- */}
        {zone === "desktop" && (
          <aside aria-label="Blocks" className="ff-pane ff-pane--left w-[272px] shrink-0 overflow-y-auto">
            <LeftPane />
          </aside>
        )}

        {zone === "tablet" && (
          <nav
            aria-label="Builder panes"
            className="ff-pane ff-pane--left flex w-14 shrink-0 flex-col items-center gap-2 py-3"
          >
            <button
              ref={railButtonRef}
              type="button"
              className="ff-icon-btn"
              aria-label="Show blocks panel"
              aria-expanded={railExpanded}
              onClick={() => setRailExpanded(true)}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <a
              href={`/d/${state.docId}/logic`}
              className="ff-icon-btn"
              aria-label="Logic rules"
              title="Logic rules"
            >
              <span aria-hidden="true">ƒ</span>
            </a>
          </nav>
        )}

        {/* --- center: canvas (§12 region labelled "Form editor") --------------- */}
        <main aria-label="Form editor" className="min-w-0 flex-1 overflow-y-auto">
          <Canvas />
        </main>

        {/* --- right: settings --------------------------------------------------- */}
        {zone === "desktop" && (
          <aside aria-label="Settings" className="ff-pane ff-pane--right w-[320px] shrink-0 overflow-y-auto">
            {rightPane}
          </aside>
        )}
      </div>

      {/* --- tablet: blocks rail overlay ---------------------------------------- */}
      {zone === "tablet" && railExpanded && (
        <div className="fixed inset-0 z-40" data-testid="rail-overlay">
          <div aria-hidden="true" className="absolute inset-0 bg-black/30" onClick={closeOverlays} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Blocks"
            className="ff-pane ff-pane--left absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col shadow-xl"
          >
            {overlayHeader("Blocks", "Close blocks panel")}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <LeftPane />
            </div>
          </div>
        </div>
      )}

      {/* --- tablet: settings slide-over drawer ---------------------------------- */}
      {zone === "tablet" && settingsOpen && (
        <div className="fixed inset-0 z-40" data-testid="settings-drawer">
          <div aria-hidden="true" className="absolute inset-0 bg-black/30" onClick={closeOverlays} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="ff-pane ff-pane--right absolute inset-y-0 right-0 flex w-[320px] max-w-[90vw] flex-col shadow-xl"
          >
            {overlayHeader("Settings", "Close settings panel")}
            <div className="min-h-0 flex-1 overflow-y-auto">{rightPane}</div>
          </div>
        </div>
      )}

      {/* --- mobile: Blocks / Settings bottom bar --------------------------------- */}
      {zone === "mobile" && (
        <nav
          aria-label="Builder panes"
          className="ff-pane ff-pane--top flex shrink-0"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <button
            ref={blocksSheetButtonRef}
            type="button"
            className="min-h-11 flex-1 border-0 bg-transparent px-3 py-2 font-medium"
            aria-expanded={sheet === "blocks"}
            onClick={() => setSheet("blocks")}
          >
            <span aria-hidden="true">☰</span> Blocks
          </button>
          <button
            ref={settingsSheetButtonRef}
            type="button"
            className="min-h-11 flex-1 border-0 bg-transparent px-3 py-2 font-medium"
            style={{ borderLeft: "1px solid var(--ff-border)" }}
            aria-expanded={sheet === "settings"}
            onClick={() => setSheet("settings")}
          >
            <span aria-hidden="true">⚙</span> Settings
          </button>
        </nav>
      )}

      {/* --- mobile: ~70vh bottom sheets ------------------------------------------- */}
      {zone === "mobile" && sheet !== null && (
        <div className="fixed inset-0 z-40" data-testid="bottom-sheet">
          <div aria-hidden="true" className="absolute inset-0 bg-black/30" onClick={closeOverlays} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={sheet === "blocks" ? "Blocks" : "Settings"}
            className="ff-pane ff-pane--top absolute inset-x-0 bottom-0 flex h-[70vh] flex-col rounded-t-2xl shadow-2xl"
          >
            {overlayHeader(sheet === "blocks" ? "Blocks" : "Settings", sheet === "blocks" ? "Close blocks panel" : "Close settings panel")}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sheet === "blocks" ? <LeftPane /> : rightPane}
            </div>
          </div>
        </div>
      )}

      <UndoToast />
    </div>
  );
}
