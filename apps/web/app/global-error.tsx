// Global error boundary: fires when the root layout itself throws, so it
// must render its own <html>/<body>. globals.css is imported directly so
// the --ff-* tokens and .ff-btn recipes exist in this isolated shell;
// layout-critical styles are ALSO inlined below so the page survives even
// if the stylesheet chunk fails to load. Same aurora composition as
// app/error.tsx: centered stage, radial violet/cyan washes, huge display
// heading with gradient accent, dashboard CTA + glass retry.
"use client";

import { useEffect, type CSSProperties } from "react";

import "./globals.css";

const EASE = "var(--ff-ease-out)";

const BLOB: CSSProperties = {
  borderRadius: "9999px",
  pointerEvents: "none",
  position: "absolute",
};

// The .ff-btn classes provide hover/focus/active states when the stylesheet
// loads; the inline styles guarantee the look even when it doesn't.
const BTN_PRIMARY_STYLE: CSSProperties = {
  alignItems: "center",
  background: "var(--ff-grad)",
  border: "none",
  borderRadius: "999px",
  boxShadow:
    "inset 0 1px 0 color-mix(in srgb, var(--ff-primary-fg) 18%, transparent), var(--ff-glow)",
  color: "var(--ff-primary-fg)",
  cursor: "pointer",
  display: "inline-flex",
  fontFamily: "var(--ff-font-body)",
  fontSize: "0.875rem",
  fontWeight: 600,
  gap: "0.5rem",
  justifyContent: "center",
  minHeight: "2.75rem",
  padding: "0 1.25rem",
  textDecoration: "none",
  transition: `transform 180ms ${EASE}, filter 180ms ${EASE}`,
};

const BTN_SECONDARY_STYLE: CSSProperties = {
  alignItems: "center",
  background: "color-mix(in srgb, var(--ff-fg) 5%, transparent)",
  border: "1px solid var(--ff-border-strong)",
  borderRadius: "999px",
  color: "var(--ff-fg)",
  cursor: "pointer",
  display: "inline-flex",
  fontFamily: "var(--ff-font-body)",
  fontSize: "0.875rem",
  fontWeight: 500,
  gap: "0.5rem",
  justifyContent: "center",
  minHeight: "2.75rem",
  padding: "0 1.25rem",
  transition: `transform 180ms ${EASE}, background-color 180ms ${EASE}`,
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
          background: "var(--ff-bg)",
          color: "var(--ff-fg)",
          fontFamily: "var(--ff-font-body)",
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
            overflow: "hidden",
            padding: "2rem 1.5rem",
            position: "relative",
            textAlign: "center",
          }}
        >
          {/* aurora field — decorative washes only */}
          <div
            aria-hidden="true"
            style={{ inset: 0, overflow: "hidden", position: "absolute" }}
          >
            <div
              style={{
                ...BLOB,
                top: "-14rem",
                left: "6%",
                width: "34rem",
                height: "34rem",
                background:
                  "radial-gradient(closest-side, color-mix(in srgb, var(--ff-primary) 24%, transparent), transparent)",
              }}
            />
            <div
              style={{
                ...BLOB,
                top: "-8rem",
                right: "-10rem",
                width: "26rem",
                height: "26rem",
                background:
                  "radial-gradient(closest-side, color-mix(in srgb, var(--ff-accent) 15%, transparent), transparent)",
              }}
            />
            <div
              style={{
                ...BLOB,
                bottom: "-16rem",
                left: "50%",
                transform: "translateX(-50%)",
                width: "46rem",
                height: "36rem",
                background:
                  "radial-gradient(closest-side, color-mix(in srgb, var(--ff-primary-2) 13%, transparent), transparent)",
              }}
            />
          </div>

          <div
            aria-hidden="true"
            style={{
              alignItems: "center",
              background: "var(--ff-danger-soft)",
              borderRadius: "1rem",
              boxShadow:
                "inset 0 0 0 1px color-mix(in srgb, var(--ff-danger) 28%, transparent)",
              color: "var(--ff-danger)",
              display: "flex",
              height: "3.5rem",
              justifyContent: "center",
              width: "3.5rem",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={22}
              height={22}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </div>

          <h1
            style={{
              color: "var(--ff-fg)",
              fontFamily: "var(--ff-font-heading)",
              fontSize: "clamp(2.75rem, 8vw, 5rem)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              margin: "1.5rem 0 0",
            }}
          >
            Something{" "}
            <span
              style={{
                background: "var(--ff-grad)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              broke
            </span>
          </h1>

          <p
            style={{
              color: "var(--ff-muted)",
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
                border: "1px solid var(--ff-border)",
                borderRadius: "999px",
                color: "var(--ff-muted)",
                fontFamily: "var(--ff-font-mono)",
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
            <a href="/dashboard" className="ff-btn ff-btn-primary" style={BTN_PRIMARY_STYLE}>
              Back to dashboard
            </a>
            <button
              type="button"
              onClick={reset}
              className="ff-btn ff-btn-secondary"
              style={BTN_SECONDARY_STYLE}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
