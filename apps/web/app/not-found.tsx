// Root 404 for unmatched routes. The (marketing) chrome does not wrap
// unmatched paths, so this page carries its own minimal brand row and a
// full-height centered Meridian composition: a giant tabular mono numeral
// in washed ink, a Sora 600 title, a muted explanation and one secondary
// action back to the dashboard.
import Link from "next/link";

import { BTN_SECONDARY } from "@/lib/ui";

function Wordmark() {
  return (
    <span
      className="whitespace-nowrap text-[1.0625rem] font-semibold tracking-tight text-[var(--ff-fg)]"
      style={{ fontFamily: "var(--ff-font-heading)" }}
    >
      FormForge
    </span>
  );
}

function BrandMark() {
  return (
    <Link
      href="/"
      aria-label="FormForge home"
      className="flex shrink-0 items-center gap-2.5 no-underline"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center"
        style={{
          background: "var(--ff-primary)",
          borderRadius: "calc(var(--ff-radius) * 0.7)",
          color: "var(--ff-primary-fg)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
      </span>
      <Wordmark />
    </Link>
  );
}

export default function RootNotFound() {
  return (
    <div className="flex min-h-dvh flex-col px-6">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between border-b border-[var(--ff-border)] py-5">
        <BrandMark />
        <Link
          href="/templates"
          className="text-sm font-medium text-[var(--ff-muted)] transition-colors duration-200 hover:text-[var(--ff-fg)]"
        >
          Templates
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
        {/* ghost numeral — mono, tabular, quiet ink wash on paper */}
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
          404
        </div>
        <h1
          className="text-balance font-semibold text-[var(--ff-fg)]"
          style={{
            fontFamily: "var(--ff-font-heading)",
            fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
          }}
        >
          Page not found
        </h1>
        <p className="max-w-[40ch] text-sm leading-relaxed text-[var(--ff-muted)]">
          This page was moved, deleted, or never existed.
        </p>
        <div className="mt-3">
          <Link href="/dashboard" className={BTN_SECONDARY}>
            Back to dashboard
          </Link>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl border-t border-[var(--ff-border)] py-5">
        <p className="text-xs text-[var(--ff-muted)]">
          © {new Date().getFullYear()} FormForge
        </p>
      </footer>
    </div>
  );
}
