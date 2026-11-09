"use client";

// The hero desk demo: one FormForge document, three render planes.
// - The groove (a glass segmented control) flips the sheet between
//   form, page and embed. ARIA tabs; keyboard arrows move between stops.
// - The desk "job" plays once when scrolled into view (CSS keyframes on a
//   .ff-land-play class): the receipt chip settles, then a glowing
//   "Submitted" chip pops in the sheet's corner. Without JS or with reduced
//   motion the finished state simply shows (content visible with scripting
//   off).

import { useCallback, useEffect, useRef, useState } from "react";

type Plane = "form" | "page" | "embed";

const PLANES: ReadonlyArray<{ id: Plane; label: string }> = [
  { id: "form", label: "Form" },
  { id: "page", label: "Page" },
  { id: "embed", label: "Embed" },
];

const EMBED_SNIPPET =
  '<iframe src="https://example.com/embed/rsvp" title="Cooking class RSVP"></iframe>';

export function DeskDemo() {
  const [plane, setPlane] = useState<Plane>("form");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  // Play the authored moment once, only while the desk is actually on screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          root.classList.add("ff-land-play");
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const onGrooveKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = PLANES.findIndex((p) => p.id === plane);
      const delta = event.key === "ArrowRight" ? 1 : PLANES.length - 1;
      const target = PLANES[(index + delta) % PLANES.length];
      if (!target) return;
      setPlane(target.id);
      document.getElementById(`ff-land-tab-${target.id}`)?.focus();
    },
    [plane],
  );

  const copySnippet = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(EMBED_SNIPPET);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopyState("idle"), 2500);
  }, []);

  return (
    <div
      ref={rootRef}
      className="ff-land-desk"
      role="group"
      aria-label="One FormForge document shown as a form, a page and an embed"
    >
      <div className="ff-land-sheet">
        <div className="ff-land-planes" data-active={plane}>
          {/* Plane 1: the form, filled, receipt tucked, state pressed */}
          <div
            role="tabpanel"
            id="ff-land-plane-form"
            aria-labelledby="ff-land-tab-form"
            className="ff-land-plane ff-land-plane-form"
          >
            <p className="ff-land-sheet-title">Cooking class RSVP</p>
            <hr className="ff-land-sheet-rule" />
            <div className="ff-land-field">
              <label htmlFor="ff-land-demo-name">Name</label>
              <input
                id="ff-land-demo-name"
                defaultValue="Ana"
                readOnly
                tabIndex={-1}
              />
            </div>
            <div className="ff-land-field">
              <label htmlFor="ff-land-demo-attending">Attending</label>
              <input
                id="ff-land-demo-attending"
                defaultValue="Yes, plus one"
                readOnly
                tabIndex={-1}
              />
            </div>
            <div className="ff-land-reply" aria-hidden="true">
              <small>Response</small>
              <strong>Ana says yes, plus one</strong>
            </div>
            <p className="ff-land-press-mark" aria-hidden="true">
              Submitted
            </p>
          </div>

          {/* Plane 2: the same document as a scroll page */}
          <div
            role="tabpanel"
            id="ff-land-plane-page"
            aria-labelledby="ff-land-tab-page"
            className="ff-land-plane ff-land-plane-page"
          >
            <p className="ff-land-minihead">Cooking class, Thursday at six</p>
            <p className="ff-land-minibody">
              Twelve seats at the long table in Alfama. We cook, we eat,
              everyone takes a jar home.
            </p>
            <p className="ff-land-minibody">
              Bring someone; the more hands, the better the sauce.
            </p>
          </div>

          {/* Plane 3: the same document as an embed */}
          <div
            role="tabpanel"
            id="ff-land-plane-embed"
            aria-labelledby="ff-land-tab-embed"
            className="ff-land-plane ff-land-plane-embed"
          >
            <p className="ff-land-code">{EMBED_SNIPPET}</p>
            <div className="ff-land-embed-actions">
              <button
                type="button"
                className="ff-land-btn ff-land-btn--card ff-land-btn--small"
                onClick={copySnippet}
              >
                {copyState === "copied" ? "Copied" : "Copy snippet"}
              </button>
              <span className="ff-land-small" role="status">
                {copyState === "copied"
                  ? "Pasted wherever you need it."
                  : copyState === "failed"
                    ? "Copy didn’t work. Select the snippet and copy manually."
                    : ""}
              </span>
            </div>
            <p className="ff-land-small ff-land-embed-note">
              The same document, dropped into any site.
            </p>
          </div>
        </div>
      </div>

      {/* The groove: a choice of three planes on a glass segmented control */}
      <div
        className="ff-land-groove"
        data-active={plane}
        role="tablist"
        aria-label="Render plane"
        onKeyDown={onGrooveKeyDown}
      >
        <span className="ff-land-groove-thumb" aria-hidden="true" />
        {PLANES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            id={`ff-land-tab-${p.id}`}
            aria-selected={plane === p.id}
            aria-controls={`ff-land-plane-${p.id}`}
            tabIndex={plane === p.id ? 0 : -1}
            className="ff-land-groove-btn"
            onClick={() => setPlane(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
