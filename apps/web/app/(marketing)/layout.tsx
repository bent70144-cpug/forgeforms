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
// "Aurora Glass" edition: a sticky frosted-glass header (var(--ff-glass) +
// --ff-glass-border) with a gradient wordmark and an aurora hairline, and a
// matching glass footer carrying the same hairline. Every color rides the
// --ff-* tokens, so the light scheme flips automatically via
// prefers-color-scheme. Pure server components — no client JS.

const HEADER_FOOTER_GLASS = {
  backgroundColor: "var(--ff-glass)",
  WebkitBackdropFilter: "blur(16px) saturate(1.5)",
  backdropFilter: "blur(16px) saturate(1.5)",
} as const;

/** Violet→cyan hairline that fades out at both ends (the "aurora" seam). */
function AuroraHairline({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 h-px ${className ?? ""}`}
      style={{
        background:
          "linear-gradient(90deg, transparent, color-mix(in srgb, var(--ff-primary) 55%, transparent) 30%, color-mix(in srgb, var(--ff-accent) 45%, transparent) 70%, transparent)",
      }}
    />
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
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[var(--ff-primary-fg)] shadow-[var(--ff-glow)]"
        style={{ backgroundImage: "var(--ff-grad)" }}
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
      <span
        className="bg-clip-text text-[1.0625rem] font-semibold tracking-tight text-transparent"
        style={{ backgroundImage: "var(--ff-grad)" }}
      >
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
    "text-[0.875rem] text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-accent-soft)]";
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
      <header
        className="sticky top-0 z-40 border-b border-[var(--ff-glass-border)]"
        style={HEADER_FOOTER_GLASS}
      >
        <AuroraHairline className="bottom-0" />
        <div className="relative mx-auto flex h-[3.75rem] max-w-6xl items-center justify-between gap-4 px-[clamp(1rem,3vw,1.5rem)]">
          <BrandMark />
          <nav aria-label="Site" className="flex items-center gap-4 text-[0.875rem] sm:gap-6">
            <Link
              href="/templates"
              className="text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-accent-soft)]"
            >
              Templates
            </Link>
            <Link
              href="/dpa"
              className="hidden text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-accent-soft)] sm:inline-flex"
            >
              DPA
            </Link>
            <Link
              href="/login"
              className="hidden text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-accent-soft)] sm:inline-flex"
            >
              Log in
            </Link>
            <Link href="/register" className={BTN_PRIMARY}>
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer
        className="relative border-t border-[var(--ff-glass-border)]"
        style={{
          ...HEADER_FOOTER_GLASS,
          backgroundImage:
            "radial-gradient(44rem 16rem at 50% 130%, color-mix(in srgb, var(--ff-primary) 10%, transparent), transparent 70%)",
        }}
      >
        <AuroraHairline className="top-0" />
        <div className="relative mx-auto max-w-6xl px-[clamp(1rem,3vw,1.5rem)] py-10 sm:py-12">
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
