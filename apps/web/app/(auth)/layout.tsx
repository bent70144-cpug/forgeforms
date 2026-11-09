import Link from "next/link";
import type { ReactNode } from "react";

// Shared chrome for /login, /register, /forgot and /reset-password — the
// "aurora field" welcome mat. The .ff-auth-* recipes in globals.css carry
// the glass card, muted alt rows and the hairline divider; this file adds
// the brand moment around them: a gradient logo mark top-center, violet/cyan
// radial glows pooled behind the card and a thin footer. Server components
// only — no client JS, no new deps.
//
// Vertical rhythm on tall viewports: brand pinned to the top edge, the card
// centered in the leftover space (margin-block:auto on <main> absorbs the
// free space ahead of justify-content), footer at the bottom edge. When the
// card outgrows the viewport the auto margins collapse to zero and the
// column scrolls naturally, so the top of the card always stays reachable.

/* Violet/cyan pools behind the card — tokenized so the light scheme flips
   automatically (no hard-coded white/black anywhere). */
const AURORA_GLOWS = [
  "radial-gradient(36rem 22rem at 50% 34%, color-mix(in srgb, var(--ff-primary) 16%, transparent), transparent 68%)",
  "radial-gradient(26rem 18rem at 80% 16%, color-mix(in srgb, var(--ff-accent) 10%, transparent), transparent 70%)",
  "radial-gradient(30rem 20rem at 14% 76%, color-mix(in srgb, var(--ff-primary-2) 9%, transparent), transparent 70%)",
].join(", ");

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

/* Gradient tile + wordmark — the same lightning bolt as the app-shell brand
   mark, but wearing the full violet→cyan gradient and a glow so the auth
   pages get a real brand moment. Pure CSS/inline SVG; no assets. */
function BrandLockup() {
  return (
    <Link
      href="/"
      aria-label="FormForge home"
      className="inline-flex flex-col items-center gap-3 no-underline"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
        style={{
          background: "var(--ff-grad)",
          color: "var(--ff-primary-fg)",
          boxShadow: "var(--ff-glow)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={20}
          height={20}
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
    <div className="ff-auth-layout relative" style={{ minHeight: "100dvh" }}>
      {/* Aurora pools behind the card. Painted first; the siblings below are
          positioned, so content stacks above this translucent wash. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: AURORA_GLOWS }}
      />

      <header className="relative">
        <BrandLockup />
      </header>

      <main className="relative flex w-full justify-center" style={{ marginBlock: "auto" }}>
        <div className="ff-auth-card">{children}</div>
      </main>

      {/* Thin footer — terms/privacy live on the marketing half; keep this
          quiet so the card stays the moment. */}
      <footer className="relative text-xs text-[var(--ff-muted)]">© 2026 FormForge</footer>
    </div>
  );
}
