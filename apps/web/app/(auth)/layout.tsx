import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

// Shared chrome for /login, /register, /forgot and /reset-password. Split
// screen on lg+: a brand panel with the product story on the left and the
// centered form card on the right; a single centered column below lg. The
// .ff-auth-* classes in globals.css are superseded by Tailwind equivalents
// here (they remain defined for back-compat but are no longer rendered).

// 28px ink tile + white lightning + wordmark — mirrors the app shell brand.
function BrandRow() {
  return (
    <Link
      href="/"
      aria-label="FormForge home"
      className="inline-flex items-center gap-2 no-underline"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
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

const FEATURES: { icon: IconName; title: string; detail: string }[] = [
  { icon: "layers", title: "23 block kinds", detail: "One document, three planes" },
  { icon: "flow", title: "Logic that branches", detail: "Rules, prefills and paths without code" },
  {
    icon: "chart",
    title: "Analytics built in",
    detail: "Drop-off and trends from the first response",
  },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* Brand panel — lg+ only. Paper background with a faint coral wash. */}
      <aside
        className="hidden w-[44%] shrink-0 flex-col justify-between p-12 lg:flex"
        style={{
          backgroundColor: "var(--ff-bg)",
          backgroundImage:
            "radial-gradient(60% 50% at 20% 10%, color-mix(in srgb, var(--ff-accent) 7%, transparent), transparent)",
        }}
      >
        <BrandRow />

        <div className="max-w-[24rem]">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">Forms that think.</h2>
          <p className="mt-3 text-sm text-[var(--ff-muted)]">
            Author a document once, then publish it as a conversational form, a landing page and an
            embed.
          </p>

          <ul className="mt-8">
            {FEATURES.map((feature) => (
              <li
                key={feature.title}
                className="flex items-start gap-3 border-t border-[var(--ff-border)] py-4"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                  style={{
                    background: "color-mix(in srgb, var(--ff-accent) 12%, var(--ff-card))",
                    color: "var(--ff-accent)",
                  }}
                >
                  <Icon name={feature.icon} size={16} />
                </span>
                <span className="flex flex-col gap-0.5 pt-0.5">
                  <span className="text-sm font-medium">{feature.title}</span>
                  <span className="text-[13px] text-[var(--ff-muted)]">{feature.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-[var(--ff-muted)]">© 2026 FormForge</p>
      </aside>

      {/* Form column — centered, scrolls instead of clipping on short viewports.
          `justify-center-safe` (Tailwind ≥4.1 → `justify-content: safe center`)
          keeps the centered look when the card fits but start-aligns when it
          overflows (landscape phones / short viewports), so the top of the card
          stays reachable by scroll instead of being clipped. */}
      <main className="flex min-h-dvh flex-1 flex-col items-center justify-center-safe overflow-y-auto p-8">
        <div className="mb-6 lg:hidden">
          <BrandRow />
        </div>
        <div
          className="ff-panel flex w-full max-w-[26rem] flex-col gap-4 p-6 sm:p-8"
          style={{ borderRadius: "1rem", boxShadow: "var(--ff-shadow-md)" }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
