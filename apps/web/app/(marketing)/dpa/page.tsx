// T29 (spec §17 GDPR): the Data Processing Addendum page — a public,
// versioned commitment covering processor obligations for the §17 GDPR items
// (export, deletion, per-form retention). Static marketing surface; covered by
// the public-page CSP group in lib/security/csp.ts.
//
// Meridian editorial-document layout: a centered 45rem (~720px) prose column
// on paper, mono eyebrow + Sora 600 title, the version line set in mono, a
// quiet "On this page" mini TOC in a recessed well, hairline rules opening
// each numbered section, and the rights list set like a printed definition
// list (mono term line, ink description). The version line is the only
// date-like claim and is kept verbatim from the source document — no dates
// invented.
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
const PARA_BASE = "max-w-[68ch] text-[16.5px] leading-[1.7] text-[var(--ff-fg)]";
const PARA = `mt-4 ${PARA_BASE}`;
// Links read as ultramarine text at rest and take an underline on hover.
const INLINE_LINK =
  "font-medium text-[var(--ff-primary)] underline-offset-4 transition-colors hover:underline";
const INLINE_CODE =
  "rounded-[4px] border border-[var(--ff-border)] bg-[var(--ff-bg-2)] px-1 py-0.5 font-[family-name:var(--ff-font-mono)] text-[0.8125em] text-[var(--ff-fg)]";

// Rights list set like a printed definition list: hairline rows, a mono term
// line, and an ink description inheriting the article measure below it.
const RIGHTS_LIST = `m-0 mt-4 max-w-[68ch] list-none p-0 ${PARA_BASE}`;
const DEF_ITEM = "border-t border-[var(--ff-border)] py-4 first:border-t-0 first:pt-0 last:pb-0";
const DEF_TERM =
  "font-[family-name:var(--ff-font-mono)] text-[13px] font-semibold tracking-[0.01em] text-[var(--ff-fg)]";
const DEF_BODY = "mt-1.5";

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
      <ul key="rights" className={RIGHTS_LIST}>
        <li className={DEF_ITEM}>
          <strong className={DEF_TERM}>Export:</strong>
          <p className={DEF_BODY}>
            GET /api/v1/workspace/export (or Dashboard → Settings → Export) downloads a complete JSON archive of
            your workspace: members, documents, versions, submissions with answers, webhook endpoints (without
            secrets) and API tokens (without hashes).
          </p>
        </li>
        <li className={DEF_ITEM}>
          <strong className={DEF_TERM}>Workspace deletion:</strong>
          <p className={DEF_BODY}>
            Dashboard → Settings → Delete workspace. The workspace is marked deleted immediately and hard-purged
            after a 30-day grace window.
          </p>
        </li>
        <li className={DEF_ITEM}>
          <strong className={DEF_TERM}>Account deletion:</strong>
          <p className={DEF_BODY}>
            Dashboard → Settings → Delete account. Your user record, sessions, tokens and memberships are removed
            immediately; workspaces where you were the sole owner enter the same deletion grace window.
          </p>
        </li>
        <li className={DEF_ITEM}>
          <strong className={DEF_TERM}>Per-form retention:</strong>
          <p className={DEF_BODY}>
            every form accepts a retention setting (settings.retentionDays). Completed submissions older than the
            window are purged automatically by our retention job. 0 / unset means keep until you delete.
          </p>
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
      strokeWidth={1.5}
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
    <main id="top" className="mx-auto w-full max-w-[45rem] px-[clamp(1rem,3vw,1.5rem)] py-14 sm:py-16">
      <article>
        <header>
          <p className="m-0 flex items-center gap-2 font-[family-name:var(--ff-font-mono)] text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--ff-muted)]">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--ff-accent)]" />
            FormForge legal
          </p>
          <h1 className="mt-5 text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.15] tracking-[-0.02em] text-balance text-[var(--ff-fg)]">
            Data Processing Addendum
          </h1>
          {/* Muted meta row — version line kept verbatim. */}
          <p className="mt-4 font-[family-name:var(--ff-font-mono)] text-[13px] text-[var(--ff-muted)]">
            Version 1.0 — effective with the FormForge launch build.
          </p>
          <p className="mt-3 max-w-[56ch] text-lg leading-[1.7] text-[var(--ff-muted)]">
            How FormForge processes personal data on your behalf.
          </p>
        </header>

        <nav
          aria-label="On this page"
          className="mt-10 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg-2)] p-5 sm:p-6"
        >
          <p className="m-0 font-[family-name:var(--ff-font-mono)] text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-[var(--ff-muted)]">
            On this page
          </p>
          {/* Two columns from sm up: six single-line links in one column left
              ~60% of the well dead. Pairs halve the height and fill. */}
          <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0 sm:grid sm:grid-cols-2 sm:gap-x-8">
            {SECTIONS.map((s) => (
              <li key={s.anchor}>
                <a
                  href={`#${s.anchor}`}
                  className="inline-flex items-center gap-1.5 text-sm text-[var(--ff-muted)] no-underline transition-colors hover:text-[var(--ff-fg)]"
                >
                  <Icon name="chevronRight" size={12} className="shrink-0 text-[var(--ff-muted)]" />
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {SECTIONS.map((s) => (
          <section key={s.anchor} id={s.anchor} className="mt-10 scroll-mt-24 border-t border-[var(--ff-border)] pt-8">
            <h2 className="text-xl font-semibold leading-snug tracking-[-0.02em] text-[var(--ff-fg)]">{s.heading}</h2>
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
