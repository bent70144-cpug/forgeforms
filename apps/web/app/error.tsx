// Route-level error boundary. Next.js mounts this inside the root layout,
// so design tokens from globals.css are available — no self-contained
// shell needed. The retry button calls reset() to re-render the segment.
// Aurora composition: full-height centered stage with radial violet/cyan
// washes, a huge Space Grotesk display heading and the canonical CTAs.
"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Icon } from "@/components/ui/icons";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

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
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      {/* aurora field — decorative washes only (pointer-events: none) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-44 left-[8%] h-[34rem] w-[34rem] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--ff-primary) 24%, transparent), transparent)",
          }}
        />
        <div
          className="absolute -right-32 -top-24 h-[26rem] w-[26rem] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--ff-accent) 15%, transparent), transparent)",
          }}
        />
        <div
          className="absolute -bottom-40 left-1/2 h-[36rem] w-[46rem] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--ff-primary-2) 13%, transparent), transparent)",
          }}
        />
      </div>

      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{
          background: "var(--ff-danger-soft)",
          color: "var(--ff-danger)",
          boxShadow:
            "inset 0 0 0 1px color-mix(in srgb, var(--ff-danger) 28%, transparent)",
        }}
      >
        <Icon name="alert" size={22} />
      </div>

      <h1
        className="mt-6 text-balance font-semibold tracking-tight text-[var(--ff-fg)]"
        style={{
          fontFamily: "var(--ff-font-heading)",
          fontSize: "clamp(2.75rem, 8vw, 5rem)",
          lineHeight: 1.05,
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
        <Link href="/dashboard" className={BTN_PRIMARY}>
          Back to dashboard
        </Link>
        <button type="button" onClick={reset} className={BTN_SECONDARY}>
          <Icon name="refresh" size={14} />
          Try again
        </button>
      </div>
    </main>
  );
}
