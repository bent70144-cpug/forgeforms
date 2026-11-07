// Global error boundary: fires when the root layout itself throws, so it
// must render its own <html>/<body>. globals.css is imported directly so
// the --ff-* tokens exist in this isolated shell.
"use client";

import { useEffect } from "react";

import "./globals.css";

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
            gap: "0.75rem",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              alignItems: "center",
              background: "var(--ff-danger-soft)",
              borderRadius: "1rem",
              color: "var(--ff-danger)",
              display: "flex",
              height: "3rem",
              justifyContent: "center",
              width: "3rem",
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
              fontSize: "1.5rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              color: "var(--ff-muted)",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              margin: 0,
              maxWidth: "44ch",
            }}
          >
            An unexpected error interrupted the app. Retrying usually fixes it.
          </p>
          {error.digest ? (
            <p
              style={{
                border: "1px solid var(--ff-border)",
                borderRadius: "999px",
                fontFamily: "var(--ff-font-mono)",
                fontSize: "0.75rem",
                margin: "0.25rem 0 0",
                padding: "0.25rem 0.75rem",
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              background: "var(--ff-primary)",
              border: "none",
              borderRadius: "999px",
              color: "var(--ff-primary-fg)",
              cursor: "pointer",
              fontFamily: "var(--ff-font-body)",
              fontSize: "0.875rem",
              fontWeight: 500,
              marginTop: "0.75rem",
              padding: "0.625rem 1.25rem",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
