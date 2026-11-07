// Route-level error boundary. Next.js mounts this inside the root layout,
// so design tokens from globals.css are available — no self-contained
// shell needed. The retry button calls reset() to re-render the segment.
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
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{
          background: "var(--ff-danger-soft)",
          color: "var(--ff-danger)",
        }}
      >
        <Icon name="alert" size={22} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">
        Something went wrong
      </h1>
      <p className="max-w-[44ch] text-sm leading-relaxed text-[var(--ff-muted)]">
        An unexpected error interrupted this page. Retrying usually fixes it;
        your work is saved automatically where possible.
      </p>
      {error.digest ? (
        <p className="mt-1 rounded-full border border-[var(--ff-border)] px-3 py-1 font-mono text-xs text-[var(--ff-muted)]">
          ref: {error.digest}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={reset} className={BTN_PRIMARY}>
          <Icon name="refresh" size={14} />
          Try again
        </button>
        <Link href="/" className={BTN_GHOST}>
          Go home
        </Link>
      </div>
    </main>
  );
}
