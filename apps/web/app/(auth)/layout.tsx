import Link from "next/link";
import type { ReactNode } from "react";

// Shared chrome for /login, /register, /forgot and /reset-password — the
// Meridian welcome mat. The .ff-auth-* recipes in globals.css carry the
// white panel card, muted alt rows and the hairline divider; this file adds
// the brand moment around them: a quiet ultramarine logo mark top-center on
// the paper canvas (the whisper-quiet radial wash lives on <body> in
// globals.css) and a thin footer. Server components only — no client JS,
// no new deps.
//
// Vertical rhythm on tall viewports: brand pinned to the top edge, the card
// centered in the leftover space (margin-block:auto on <main> absorbs the
// free space ahead of justify-content), footer at the bottom edge. When the
// card outgrows the viewport the auto margins collapse to zero and the
// column scrolls naturally, so the top of the card always stays reachable.

/* Card heading: display face, tight tracking. Inline style rather than a
   Tailwind utility because `.ff-auth-card h1` in globals.css is unlayered
   CSS and therefore out-ranks layered utilities on these properties. */
export function AuthHeading({ children }: { children: ReactNode }) {
  return (
    <h1
      className="text-balance"
      style={{
        fontFamily: "var(--ff-font-heading)",
        fontWeight: 600,
        fontSize: "1.625rem",
        letterSpacing: "-0.03em",
        lineHeight: 1.15,
      }}
    >
      {children}
    </h1>
  );
}

/* Ultramarine tile + wordmark — the same lightning bolt as the app-shell
   brand mark, but quiet: solid primary surface, radius token, no glow.
   Pure CSS/inline SVG; no assets. */
function BrandLockup() {
  return (
    <Link
      href="/"
      aria-label="FormForge home"
      className="inline-flex flex-col items-center gap-3 no-underline"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center"
        style={{
          background: "var(--ff-primary)",
          color: "var(--ff-primary-fg)",
          borderRadius: "var(--ff-radius)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
      </span>
      <span className="flex flex-col items-center gap-1">
        <span
          className="text-[1.0625rem] font-semibold"
          style={{
            fontFamily: "var(--ff-font-heading)",
            letterSpacing: "-0.02em",
            color: "var(--ff-fg)",
          }}
        >
          FormForge
        </span>
        <span className="text-xs text-[var(--ff-muted)]">One document, every surface.</span>
      </span>
    </Link>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // minHeight: 100dvh inline — tracks mobile browser chrome better than the
    // 100vh in .ff-auth-layout and out-ranks it (inline vs stylesheet).
    <div className="ff-auth-layout" style={{ minHeight: "100dvh" }}>
      <header>
        <BrandLockup />
      </header>

      <main className="flex w-full justify-center" style={{ marginBlock: "auto" }}>
        <div className="ff-auth-card">{children}</div>
      </main>

      {/* Thin footer — quiet legal links. Terms/privacy copy lives on the
          marketing half; these point at the two legal routes that exist so
          the card stays the moment of the page. */}
      <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--ff-muted)]">
        <span>© 2026 FormForge</span>
        <span aria-hidden="true">·</span>
        <Link
          href="/dpa"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-fg)] hover:underline"
        >
          DPA
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/report-abuse"
          className="underline-offset-4 transition-colors hover:text-[var(--ff-fg)] hover:underline"
        >
          Report abuse
        </Link>
      </footer>
    </div>
  );
}
