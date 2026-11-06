// T29 (spec §17 GDPR): the Data Processing Addendum page — a public,
// versioned commitment covering processor obligations for the §17 GDPR items
// (export, deletion, per-form retention). Static marketing surface; covered by
// the public-page CSP group in lib/security/csp.ts.
export const metadata = {
  title: "FormForge — Data Processing Addendum",
  description: "How FormForge processes personal data on your behalf.",
  robots: { index: true, follow: true },
};

const SECTIONS: ReadonlyArray<{ heading: string; body: readonly string[] }> = [
  {
    heading: "1. Roles",
    body: [
      "You (the FormForge customer) are the data controller for the personal data your forms collect. FormForge (operated by the FormForge team) is the processor: we process submission data only to provide the service — storing, rendering, exporting and deleting it on your instruction.",
    ],
  },
  {
    heading: "2. What we process and where",
    body: [
      "Form submissions, form content, account details (name, email, password hash) and operational metadata (IP-derived abuse signals, timestamps) are stored in our PostgreSQL database and object storage in the region you select at signup. Backups are encrypted at rest and retained for 30 days (see the restore runbook referenced in our security checklist).",
    ],
  },
  {
    heading: "3. Your rights (and how to exercise them)",
    body: [
      "Export: GET /api/v1/workspace/export (or Dashboard → Settings → Export) downloads a complete JSON archive of your workspace: members, documents, versions, submissions with answers, webhook endpoints (without secrets) and API tokens (without hashes).",
      "Workspace deletion: Dashboard → Settings → Delete workspace. The workspace is marked deleted immediately and hard-purged after a 30-day grace window.",
      "Account deletion: Dashboard → Settings → Delete account. Your user record, sessions, tokens and memberships are removed immediately; workspaces where you were the sole owner enter the same deletion grace window.",
      "Per-form retention: every form accepts a retention setting (settings.retentionDays). Completed submissions older than the window are purged automatically by our retention job. 0 / unset means keep until you delete.",
    ],
  },
  {
    heading: "4. Sub-processors",
    body: [
      "Hosting and managed database (our infrastructure provider), transactional email delivery, payment processing (Stripe — payment data never reaches FormForge servers), and Cloudflare Turnstile for bot verification. A current sub-processor list is available on request.",
    ],
  },
  {
    heading: "5. Security & breaches",
    body: [
      "Our controls are published in docs/security-checklist.md: tenant-isolated Postgres (row-level security), argon2id password hashing, hashed shown-once tokens, allowlist-sanitized rich text, strict CSP, SSRF-guarded webhook egress and upload hardening. Suspected breaches affecting your data are reported to your workspace contact within 72 hours of confirmation.",
    ],
  },
  {
    heading: "6. Contact",
    body: [
      "Data-protection questions and DPA signature requests: privacy@formforge.example. Abuse reports: the “Report abuse” link on every public page.",
    ],
  },
];

export default function DpaPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <article className="space-y-8">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-[var(--ff-fg)] sm:text-4xl">
            Data Processing Addendum
          </h1>
          <p className="text-sm text-[var(--ff-muted)]">Version 1.0 — effective with the FormForge launch build.</p>
        </header>
        {SECTIONS.map((section) => (
          <section key={section.heading} className="space-y-4">
            <h2 className="text-lg font-semibold text-[var(--ff-fg)] sm:text-xl">{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} className="text-base leading-relaxed text-[var(--ff-fg)]">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
