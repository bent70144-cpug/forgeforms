import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: {
    default: "FormForge",
    template: "%s — FormForge",
  },
};

// Shared chrome for public marketing surfaces (templates gallery, legal docs).
// Slim server-rendered header + footer — no client JS, matches the landing's
// tone without pulling in the landing's scoped styles.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--ff-border)] bg-[var(--ff-card)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-[var(--ff-fg)] no-underline"
          >
            FormForge
          </Link>
          <nav aria-label="Site" className="flex items-center gap-6 text-sm">
            <Link
              href="/templates"
              className="text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-fg)]"
            >
              Templates
            </Link>
            <Link
              href="/login"
              className="text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-fg)]"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-[var(--ff-radius)] bg-[var(--ff-primary)] px-4 py-2 font-medium text-[var(--ff-primary-fg)] no-underline transition-[filter] hover:brightness-110"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-[var(--ff-border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-[var(--ff-muted)]">
          <p>© {new Date().getFullYear()} FormForge</p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-5">
            <Link href="/templates" className="no-underline transition-colors hover:text-[var(--ff-fg)]">
              Templates
            </Link>
            <Link href="/dpa" className="no-underline transition-colors hover:text-[var(--ff-fg)]">
              DPA
            </Link>
            <Link href="/report-abuse" className="no-underline transition-colors hover:text-[var(--ff-fg)]">
              Report abuse
            </Link>
            <a
              href="https://github.com/bent70144-cpug/forgeforms"
              className="no-underline transition-colors hover:text-[var(--ff-fg)]"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
