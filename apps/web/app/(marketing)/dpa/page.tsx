// T29 (spec §17 GDPR): the Data Processing Addendum page — a public,
// versioned commitment covering processor obligations for the §17 GDPR items
// (export, deletion, per-form retention). Static marketing surface; covered by
// the public-page CSP group in lib/security/csp.ts.
//
// Article layout: 3xl column, anchor per section (mini TOC at top), hairline
// section dividers, generous measure. The version line is the only date-like
// claim and is kept verbatim from the source document — no dates invented.
import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icons";
import { BTN_SECONDARY_SM } from "@/lib/ui";

export const metadata = {
  title: "FormForge — Data Processing Addendum",
  description: "How FormForge processes personal data on your behalf.",
  robots: { index: true, follow: true },
};

// Shared article recipes.
const PARA_BASE =
  "max-w-[68ch] text-[16.5px] leading-[1.75] text-[color-mix(in_srgb,var(--ff-fg)_88%,transparent)]";
const PARA = `mt-4 ${PARA_BASE}`;
const INLINE_LINK =
  "font-medium underline decoration-[color-mix(in_srgb,var(--ff-accent)_50%,transparent)] underline-offset-4 transition-colors hover:decoration-[var(--ff-accent)]";
const INLINE_CODE =
  "rounded-[4px] border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-1 py-0.5 font-mono text-[0.8125em]";
const LIST_ITEM = `mt-3 pl-1 marker:text-[var(--ff-accent)] ${PARA_BASE}`;

type DpaSection = {
  anchor: string;
  heading: string;
  body: readonly ReactNode[];
};

const SECTIONS: readonly DpaSection[] = [
  {
    anchor: "roles",
    heading: "1. Roles",
    body: [
      "You (the FormForge customer) are the data controller for the personal data your forms collect. FormForge (operated by the FormForge team) is the processor: we process submission data only to provide the service — storing, rendering, exporting and deleting it on your instruction.",
    ],
  },
  {
    anchor: "what-we-process",
    heading: "2. What we process and where",
    body: [
      "Form submissions, form content, account details (name, email, password hash) and operational metadata (IP-derived abuse signals, timestamps) are stored in our PostgreSQL database and object storage in the region you select at signup. Backups are encrypted at rest and retained for 30 days (see the restore runbook referenced in our security checklist).",
    ],
  },
  {
    anchor: "your-rights",
    heading: "3. Your rights (and how to exercise them)",
    body: [
      <ul key="rights" className="list-disc pl-5">
        <li className={LIST_ITEM}>
          <strong className="font-semibold text-[var(--ff-fg)]">Export:</strong> GET /api/v1/workspace/export (or
          Dashboard → Settings → Export) downloads a complete JSON archive of your workspace: members, documents,
          versions, submissions with answers, webhook endpoints (without secrets) and API tokens (without hashes).
        </li>
        <li className={LIST_ITEM}>
          <strong className="font-semibold text-[var(--ff-fg)]">Workspace deletion:</strong> Dashboard → Settings →
          Delete workspace. The workspace is marked deleted immediately and hard-purged after a 30-day grace window.
        </li>
        <li className={LIST_ITEM}>
          <strong className="font-semibold text-[var(--ff-fg)]">Account deletion:</strong> Dashboard → Settings →
          Delete account. Your user record, sessions, tokens and memberships are removed immediately; workspaces where
          you were the sole owner enter the same deletion grace window.
        </li>
        <li className={LIST_ITEM}>
          <strong className="font-semibold text-[var(--ff-fg)]">Per-form retention:</strong> every form accepts a
          retention setting (settings.retentionDays). Completed submissions older than the window are purged
          automatically by our retention job. 0 / unset means keep until you delete.
        </li>
      </ul>,
    ],
  },
  {
    anchor: "sub-processors",
    heading: "4. Sub-processors",
    body: [
      "Hosting and managed database (our infrastructure provider), transactional email delivery, payment processing (Stripe — payment data never reaches FormForge servers), and Cloudflare Turnstile for bot verification. A current sub-processor list is available on request.",
    ],
  },
  {
    anchor: "security",
    heading: "5. Security & breaches",
    body: [
      <>
        Our controls are published in <code className={INLINE_CODE}>docs/security-checklist.md</code>: tenant-isolated
        Postgres (row-level security), argon2id password hashing, hashed shown-once tokens, allowlist-sanitized rich
        text, strict CSP, SSRF-guarded webhook egress and upload hardening. Suspected breaches affecting your data are
        reported to your workspace contact within 72 hours of confirmation.
      </>,
    ],
  },
  {
    anchor: "contact",
    heading: "6. Contact",
    body: [
      <>
        Data-protection questions and DPA signature requests:{" "}
        <a href="mailto:privacy@formforge.example" className={INLINE_LINK}>
          privacy@formforge.example
        </a>
        . Abuse reports: the{" "}
        <Link href="/report-abuse" className={INLINE_LINK}>
          “Report abuse”
        </Link>{" "}
        link on every public page.
      </>,
    ],
  },
];

// Local arrow-up glyph (the shared icon set has no arrowUp; inline SVG keeps
// the no-emoji, no-CDN rule).
function ArrowUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export default function DpaPage() {
  return (
    <main id="top" className="mx-auto w-full max-w-3xl px-6 py-16">
      <article>
        <header>
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">
            Data Processing Addendum
          </h1>
          <p className="mt-3 text-sm text-[var(--ff-muted)]">
            Version 1.0 — effective with the FormForge launch build.
          </p>
          <p className="mt-4 max-w-[56ch] text-lg leading-relaxed text-[var(--ff-muted)]">
            How FormForge processes personal data on your behalf.
          </p>
        </header>

        <nav aria-label="On this page" className="ff-panel mt-10 p-5">
          <p className="m-0 text-[0.8125rem] font-semibold text-[var(--ff-fg)]">On this page</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {SECTIONS.map((s) => (
              <li key={s.anchor}>
                <a
                  href={`#${s.anchor}`}
                  className="inline-flex items-center gap-1.5 text-sm text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-fg)]"
                >
                  <Icon name="chevronRight" size={12} className="shrink-0 text-[var(--ff-accent)]" />
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {SECTIONS.map((s) => (
          <section key={s.anchor} id={s.anchor} className="scroll-mt-24">
            <h2 className="mt-12 border-t border-[var(--ff-border)] pt-6 text-xl font-semibold tracking-tight text-[var(--ff-fg)]">
              {s.heading}
            </h2>
            {s.body.map((node, i) =>
              typeof node === "string" ? (
                <p key={i} className={PARA}>
                  {node}
                </p>
              ) : (
                <div key={i}>{node}</div>
              ),
            )}
          </section>
        ))}

        <div className="mt-14 flex justify-center border-t border-[var(--ff-border)] pt-8 print:hidden">
          <a href="#top" className={BTN_SECONDARY_SM}>
            <ArrowUpIcon />
            Back to top
          </a>
        </div>
      </article>
    </main>
  );
}
