import Link from "next/link";

import { BTN_GHOST, BTN_PRIMARY } from "@/lib/ui";

/**
 * Scoped 404 for the public scroll plane (unknown/unpublished-at-404 slugs).
 * Fully self-contained: token-driven Tailwind only (no page-local globals
 * classes), so it renders correctly on the default paper theme regardless of
 * any document theme the renderer would have applied.
 */
export default function PublicPageNotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      {/* Coral wash instead of gray: ties the dead-end into the brand and
          lifts it off the paper (14% ink read as a washed-out mistake). */}
      <div
        aria-hidden="true"
        className="select-none text-6xl font-semibold leading-none text-[color-mix(in_srgb,var(--ff-accent)_32%,transparent)]"
        style={{ fontFamily: "var(--ff-font-heading)" }}
      >
        404
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">Page not found</h1>
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
  );
}
