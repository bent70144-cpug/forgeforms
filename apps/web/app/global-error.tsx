// Global error boundary: fires when the root layout itself throws, so it
// must render its own <html>/<body>. globals.css is imported directly so
// the .ff-btn hover/focus recipes and font variables exist in this isolated
// shell; every layout-critical style is ALSO inlined below using literal
// Meridian hexes — the sanctioned exception, since tokens are not guaranteed
// to have loaded when the root layout fails. Meridian composition: paper
// stage, giant tabular mono "ERR" in washed ink, Sora 600 heading, one
// ultramarine primary action.
"use client";

import { useEffect, type CSSProperties } from "react";

import "./globals.css";

// Literal Meridian light-theme values (token fallbacks are unavailable in
// this shell, so the page stays deterministic even without the stylesheet).
const PAPER = "#f7f5f0";
const INK = "#1a1d26";
const MUTED = "#686e7e";
const HAIRLINE = "#e5e1d6";
const BORDER_STRONG = "#d1ccbd";
const PRIMARY = "#3d3bf3";
const INK_WASH = "rgb(26 29 38 / 0.08)"; // ghost numeral
const INK_SLAB = "rgb(26 29 38 / 0.05)"; // secondary surface wash

// The .ff-btn classes provide hover/focus/active states when the stylesheet
// loads; the inline styles guarantee the look even when it doesn't.
const BTN_PRIMARY_STYLE: CSSProperties = {
  alignItems: "center",
  background: PRIMARY,
  border: "1px solid transparent",
  borderRadius: "0.875rem",
  boxShadow: "0 1px 2px rgb(26 29 38 / 0.08)",
  color: "#ffffff",
  cursor: "pointer",
  display: "inline-flex",
  fontFamily: "var(--ff-font-body, ui-sans-serif), system-ui, sans-serif",
  fontSize: "0.875rem",
  fontWeight: 600,
  gap: "0.5rem",
  justifyContent: "center",
  minHeight: "2.75rem",
  padding: "0 1.25rem",
  textDecoration: "none",
  transition: "transform 180ms ease, filter 180ms ease",
};

const BTN_SECONDARY_STYLE: CSSProperties = {
  alignItems: "center",
  background: INK_SLAB,
  border: `1px solid ${BORDER_STRONG}`,
  borderRadius: "0.875rem",
  color: INK,
  cursor: "pointer",
  display: "inline-flex",
  fontFamily: "var(--ff-font-body, ui-sans-serif), system-ui, sans-serif",
  fontSize: "0.875rem",
  fontWeight: 500,
  gap: "0.5rem",
  justifyContent: "center",
  minHeight: "2.75rem",
  padding: "0 1.25rem",
  textDecoration: "none",
  transition: "transform 180ms ease, background-color 180ms ease",
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: PAPER,
          color: INK,
          fontFamily: "var(--ff-font-body, ui-sans-serif), system-ui, sans-serif",
          margin: 0,
        }}
      >
        <main
          style={{
            alignItems: "center",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minHeight: "100dvh",
            padding: "2rem 1.5rem",
            textAlign: "center",
          }}
        >
          {/* ghost status mark — mono, tabular, quiet ink wash */}
          <div
            aria-hidden="true"
            style={{
              color: INK_WASH,
              fontFamily: "var(--ff-font-mono, ui-monospace), monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: "clamp(6rem, 22vw, 14rem)",
              fontWeight: 600,
              letterSpacing: "-0.04em",
              lineHeight: 0.8,
              userSelect: "none",
            }}
          >
            ERR
          </div>

          <h1
            style={{
              color: INK,
              fontFamily:
                "var(--ff-font-heading, ui-sans-serif), system-ui, sans-serif",
              fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              margin: "1.25rem 0 0",
            }}
          >
            Something broke
          </h1>

          <p
            style={{
              color: MUTED,
              fontSize: "0.9375rem",
              lineHeight: 1.6,
              margin: "1rem 0 0",
              maxWidth: "46ch",
            }}
          >
            An unexpected error interrupted the app. Retrying usually fixes it.
          </p>

          {error.digest ? (
            <p
              style={{
                border: `1px solid ${HAIRLINE}`,
                borderRadius: "999px",
                color: MUTED,
                fontFamily: "var(--ff-font-mono, ui-monospace), monospace",
                fontSize: "0.75rem",
                margin: "0.875rem 0 0",
                padding: "0.25rem 0.75rem",
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}

          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              justifyContent: "center",
              marginTop: "2rem",
            }}
          >
            <button
              type="button"
              onClick={reset}
              className="ff-btn ff-btn-primary"
              style={BTN_PRIMARY_STYLE}
            >
              Try again
            </button>
            <a
              href="/dashboard"
              className="ff-btn ff-btn-secondary"
              style={BTN_SECONDARY_STYLE}
            >
              Back to dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
