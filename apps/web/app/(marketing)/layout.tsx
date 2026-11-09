import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BTN_PRIMARY } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: {
    default: "FormForge",
    template: "%s — FormForge",
  },
};

// Shared chrome for public marketing surfaces (templates gallery, legal docs).
// "Meridian" edition: a sticky solid-paper header (var(--ff-glass), no blur)
// over a 1px hairline, a Sora 700 wordmark, and nav links in ink with a 2px
// ultramarine underline accent on hover. The footer sits on the recessed
// --ff-bg-2 well behind a hairline top rule, with quiet muted columns. Every
// color rides the --ff-* tokens, so the night scheme flips automatically via
// prefers-color-scheme. Pure server components — no client JS.

/** Editorial nav link: ink by default, muted on hover, ultramarine underline.
 *  min tap height on small screens, text height from sm up. Display is set
 *  per link (hidden/sm:inline-flex) so the classes don't fight. */
const NAV_LINK =
  "min-h-[2.5rem] items-center text-[var(--ff-fg)] no-underline transition-colors duration-200 motion-reduce:transition-none hover:text-[var(--ff-muted)] hover:underline hover:decoration-[var(--ff-primary)] hover:decoration-2 hover:underline-offset-[6px] sm:min-h-0";

function BrandMark() {
  return (
    <Link
      href="/"
      aria-label="FormForge home"
      className="flex shrink-0 items-center gap-2.5 no-underline"
    >
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[var(--ff-primary)] text-[var(--ff-primary-fg)]"
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
      <span className="text-[1.0625rem] font-bold tracking-[-0.02em] text-[var(--ff-fg)] [font-family:var(--ff-font-heading)]">
        FormForge
      </span>
    </Link>
  );
}

function FooterGroup({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ label: string; href: string; external?: boolean }>;
}) {
  const linkClass =
    "text-[0.875rem] text-[var(--ff-muted)] no-underline transition-colors duration-200 motion-reduce:transition-none hover:text-[var(--ff-fg)]";
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-[var(--ff-muted)]">
        {title}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {links.map((link) =>
          link.external ? (
            <li key={link.href}>
              <a href={link.href} className={`inline-flex items-center gap-1 ${linkClass}`}>
                {link.label}
                <Icon name="external" size={12} />
              </a>
            </li>
          ) : (
            <li key={link.href}>
              <Link href={link.href} className={linkClass}>
                {link.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Sticky chrome: solid paper at 0.94 opacity, one hairline underneath.
          The header carries the single primary CTA; everything else is quiet. */}
      <header className="sticky top-0 z-40 border-b border-[var(--ff-border)] bg-[var(--ff-glass)]">
        <div className="mx-auto flex h-[3.75rem] max-w-6xl items-center justify-between gap-4 px-[clamp(1rem,3vw,1.5rem)]">
          <BrandMark />
          <nav aria-label="Site" className="flex items-center gap-4 text-[0.875rem] sm:gap-6">
            <Link href="/templates" className={`inline-flex ${NAV_LINK}`}>
              Templates
            </Link>
            <Link href="/dpa" className={`hidden sm:inline-flex ${NAV_LINK}`}>
              DPA
            </Link>
            <Link href="/login" className={`hidden sm:inline-flex ${NAV_LINK}`}>
              Log in
            </Link>
            <Link href="/register" className={BTN_PRIMARY}>
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      {/* Recessed well: footer on --ff-bg-2 behind a hairline top rule. */}
      <footer className="border-t border-[var(--ff-border)] bg-[var(--ff-bg-2)]">
        <div className="mx-auto max-w-6xl px-[clamp(1rem,3vw,1.5rem)] py-12 sm:py-14">
          <div className="grid gap-10 md:grid-cols-[minmax(0,20rem)_1fr]">
            <div className="flex flex-col gap-3">
              <BrandMark />
              <p className="m-0 max-w-[32ch] text-[0.875rem] leading-relaxed text-[var(--ff-muted)]">
                Forms, logic and analytics — self-serve.
              </p>
            </div>
            <nav
              aria-label="Footer"
              className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:justify-self-end"
            >
              <FooterGroup title="Product" links={[{ label: "Templates", href: "/templates" }]} />
              <FooterGroup
                title="Legal"
                links={[
                  { label: "DPA", href: "/dpa" },
                  { label: "Report abuse", href: "/report-abuse" },
                ]}
              />
              <FooterGroup
                title="Connect"
                links={[
                  {
                    label: "GitHub",
                    href: "https://github.com/bent70144-cpug/forgeforms",
                    external: true,
                  },
                ]}
              />
            </nav>
          </div>
          <div className="mt-10 border-t border-[var(--ff-border)] pt-6">
            <p className="m-0 text-[0.8125rem] text-[var(--ff-muted)]">
              © {new Date().getFullYear()} FormForge
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
