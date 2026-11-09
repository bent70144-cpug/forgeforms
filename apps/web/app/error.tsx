// Route-level error boundary. Next.js mounts this inside the root layout,
// so design tokens from globals.css are available — no self-contained
// shell needed. The retry button calls reset() to re-render the segment.
// Meridian composition: quiet paper stage with a giant tabular mono "ERR"
// mark in washed ink, a Sora 600 heading, the digest reference in mono and
// a single ultramarine primary action.
"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Icon } from "@/components/ui/icons";
import { BTN_GHOST, BTN_PRIMARY } from "@/lib/ui";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for observability tooling; the UI stays non-technical.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      {/* ghost status mark — mono, tabular, quiet ink wash on paper.
          Route boundaries carry no fixed HTTP status, so the telemetry
          abbreviation stands in for a numeral. */}
      <div
        aria-hidden="true"
        className="select-none"
        style={{
          color: "color-mix(in srgb, var(--ff-fg) 8%, transparent)",
          fontFamily: "var(--ff-font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "clamp(6rem, 22vw, 14rem)",
          fontWeight: 600,
          letterSpacing: "-0.04em",
          lineHeight: 0.8,
        }}
      >
        ERR
      </div>

      <h1
        className="mt-3 text-balance font-semibold text-[var(--ff-fg)]"
        style={{
          fontFamily: "var(--ff-font-heading)",
          fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
        }}
      >
        Something broke
      </h1>

      <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-[var(--ff-muted)]">
        An unexpected error interrupted this page. Retrying usually fixes it;
        your work is saved automatically where possible.
      </p>

      {error.digest ? (
        <p
          className="mt-3 rounded-full border border-[var(--ff-border)] px-3 py-1 text-xs text-[var(--ff-muted)]"
          style={{ fontFamily: "var(--ff-font-mono)" }}
        >
          ref: {error.digest}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
        <button type="button" onClick={reset} className={BTN_PRIMARY}>
          <Icon name="refresh" size={14} />
          Try again
        </button>
        <Link href="/dashboard" className={BTN_GHOST}>
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
