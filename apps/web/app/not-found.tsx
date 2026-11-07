// Root 404 for unmatched routes. The (marketing) chrome does not wrap
// unmatched paths, so this page carries its own minimal brand row and
// mirrors the public-plane 404 language (coral numeral on paper).
import Link from "next/link";

import { BTN_GHOST, BTN_PRIMARY } from "@/lib/ui";

function BrandMark() {
  return (
    <Link
      href="/"
      aria-label="FormForge home"
      className="flex shrink-0 items-center gap-2 no-underline"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{
          background: "var(--ff-primary)",
          color: "var(--ff-primary-fg)",
          boxShadow: "var(--ff-shadow-sm)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
      </span>
      <span className="text-[1.0625rem] font-semibold tracking-tight text-[var(--ff-fg)]">
        FormForge
      </span>
    </Link>
  );
}

export default function RootNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--ff-bg)] px-6">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between py-5">
        <BrandMark />
        <Link
          href="/templates"
          className="text-sm font-medium text-[var(--ff-muted)] transition-colors duration-200 hover:text-[var(--ff-fg)]"
        >
          Templates
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-center">
        <div
          aria-hidden="true"
          className="select-none text-6xl font-semibold leading-none text-[color-mix(in_srgb,var(--ff-accent)_32%,transparent)]"
          style={{ fontFamily: "var(--ff-font-heading)" }}
        >
          404
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">
          Page not found
        </h1>
        <p className="max-w-[40ch] text-sm leading-relaxed text-[var(--ff-muted)]">
          This page was moved, deleted, or never existed.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Link href="/" className={BTN_PRIMARY}>
            Go home
          </Link>
          <Link href="/templates" className={BTN_GHOST}>
            Browse templates
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
