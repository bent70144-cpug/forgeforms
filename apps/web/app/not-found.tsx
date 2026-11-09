// Root 404 for unmatched routes. The (marketing) chrome does not wrap
// unmatched paths, so this page carries its own minimal brand row and a
// full-height centered aurora composition: huge Space Grotesk display
// numeral with a violet→cyan gradient, muted explanation and the canonical
// CTAs (dashboard primary, templates glass secondary).
import Link from "next/link";

import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

function Wordmark() {
  return (
    <span
      className="whitespace-nowrap text-[1.0625rem] font-semibold tracking-tight text-[var(--ff-fg)]"
      style={{ fontFamily: "var(--ff-font-heading)" }}
    >
      Form
      <span
        style={{
          background: "var(--ff-grad)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        Forge
      </span>
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
        className="flex h-8 w-8 items-center justify-center rounded-xl"
        style={{
          background: "var(--ff-grad)",
          color: "var(--ff-primary-fg)",
          boxShadow: "var(--ff-glow)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={15}
          height={15}
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
      <Wordmark />
    </Link>
  );
}

export default function RootNotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[var(--ff-bg)] px-6">
      {/* aurora field — decorative washes only */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-44 left-[10%] h-[36rem] w-[36rem] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--ff-primary) 22%, transparent), transparent)",
          }}
        />
        <div
          className="absolute -right-32 -top-16 h-[28rem] w-[28rem] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--ff-accent) 14%, transparent), transparent)",
          }}
        />
        <div
          className="absolute -bottom-44 left-1/2 h-[34rem] w-[48rem] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--ff-primary-2) 12%, transparent), transparent)",
          }}
        />
      </div>

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between py-5">
        <BrandMark />
        <Link
          href="/templates"
          className="text-sm font-medium text-[var(--ff-muted)] transition-colors duration-200 hover:text-[var(--ff-fg)]"
        >
          Templates
        </Link>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
        {/* glow pooled behind the numeral */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[26rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--ff-primary) 14%, transparent), transparent)",
          }}
        />
        <div
          aria-hidden="true"
          className="select-none font-semibold leading-[0.85] tracking-[-0.04em]"
          style={{
            background: "var(--ff-grad)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            fontFamily: "var(--ff-font-heading)",
            fontSize: "clamp(5.5rem, 20vw, 12rem)",
          }}
        >
          404
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">
          Page not found
        </h1>
        <p className="max-w-[40ch] text-sm leading-relaxed text-[var(--ff-muted)]">
          This page was moved, deleted, or never existed.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
          <Link href="/dashboard" className={BTN_PRIMARY}>
            Back to dashboard
          </Link>
          <Link href="/templates" className={BTN_SECONDARY}>
            Browse templates
          </Link>
        </div>
      </main>

      <footer className="relative mx-auto w-full max-w-5xl border-t border-[var(--ff-border)] py-5">
        <p className="text-xs text-[var(--ff-muted)]">
          © {new Date().getFullYear()} FormForge
        </p>
      </footer>
    </div>
  );
}
