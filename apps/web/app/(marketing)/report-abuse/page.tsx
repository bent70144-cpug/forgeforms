import type { Metadata } from "next";
import { Icon } from "@/components/ui/icons";
import {
  BANNER_ERROR,
  BANNER_SUCCESS,
  BANNER_WARNING,
  BTN_GHOST,
  BTN_PRIMARY,
} from "@/lib/ui";

// "Report abuse" page (spec §17) — destination of the Report-abuse link
// rendered on every public page (/p/*, custom-host renders, /embed/*). Lives in
// the (marketing) group so it inherits the public chrome; the URL is unchanged.
//
// Deliberately dependency-free: a static explanation + a form that POSTs to
// /api/public/abuse-report (no PII requested beyond the form's own reference;
// the report is written to the server log for staff review). form-action is
// covered by the public-page CSP ('self').
//
// Meridian layout: a quiet left-aligned masthead (terracotta alert mark on a
// recessed circle, Sora title, muted explainer) above a single white .ff-panel
// card carrying the warning banner, the document reference, the status banners
// and the form.

export const metadata: Metadata = {
  title: "Report abuse",
  description:
    "Report a FormForge page that collects prohibited content, impersonates you, or is used for spam or phishing.",
};

type ReportAbuseProps = {
  searchParams: Promise<{ document?: string; submitted?: string; error?: string }>;
};

export default async function ReportAbusePage({ searchParams }: ReportAbuseProps) {
  const params = await searchParams;
  const documentRef = typeof params.document === "string" ? params.document : "";
  const submitted = params.submitted === "1";
  const rateLimited = params.error === "ratelimited";
  const errored = params.error === "1";

  return (
    <main className="mx-auto w-full max-w-2xl px-[clamp(1rem,3vw,1.5rem)] py-12 sm:py-16">
      <article>
        <header>
          <span
            aria-hidden="true"
            className="grid h-11 w-11 place-items-center rounded-full border border-[var(--ff-border)] bg-[var(--ff-bg-2)] text-[var(--ff-accent)]"
          >
            <Icon name="alert" size={20} />
          </span>
          <h1 className="mt-5 text-[clamp(1.75rem,3vw,2.25rem)] font-semibold leading-[1.15] tracking-[-0.02em] text-balance text-[var(--ff-fg)]">
            Report abuse
          </h1>
          <p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-[1.7] text-[var(--ff-muted)]">
            If a form or page hosted on FormForge collects prohibited content (for example card numbers,
            passwords or government identifiers), impersonates you, or is used for spam or phishing, tell
            us and our team will take it down.
          </p>
        </header>

        {/* Report card: warning banner → document ref → status banners → form */}
        <section aria-label="Abuse report form" className="ff-panel mt-8 p-6 sm:p-8">
          <p className={BANNER_WARNING}>
            This form is for reporting abusive pages only — it goes to the FormForge team, never to the
            owner of the page you are reporting.
          </p>

          {documentRef ? (
            <p className="mb-0 mt-5 text-sm text-[var(--ff-muted)]">
              Reporting document:{" "}
              <code
                data-testid="report-document-ref"
                className="break-all rounded-[8px] border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-bg)_36%,var(--ff-card))] px-1.5 py-0.5 font-[family-name:var(--ff-font-mono)] text-[13px] text-[var(--ff-fg)]"
              >
                {documentRef}
              </code>
            </p>
          ) : (
            <p className="mb-0 mt-5 text-sm leading-relaxed text-[var(--ff-muted)]">
              Tip: every public FormForge page carries a “Report abuse” link that prefills the document
              reference automatically.
            </p>
          )}

          {submitted ? (
            <p role="status" className={`${BANNER_SUCCESS} mt-5`}>
              Thank you — your report was received and will be reviewed by the FormForge team.
            </p>
          ) : null}
          {rateLimited ? (
            <p role="alert" className={`${BANNER_ERROR} mt-5`}>
              Too many reports sent from your network just now — please wait a minute and try again.
            </p>
          ) : null}
          {errored ? (
            <p role="alert" className={`${BANNER_ERROR} mt-5`}>
              That report couldn’t be accepted — check the document reference and try again.
            </p>
          ) : null}

          <form action="/api/public/abuse-report" method="post" className="mt-6 space-y-5">
            <div className="ff-field">
              <label htmlFor="abuse-document-ref" className="text-sm!">
                Document link or reference (required)
              </label>
              <input id="abuse-document-ref" name="documentRef" required defaultValue={documentRef} />
            </div>
            <div className="ff-field">
              <label htmlFor="abuse-reason" className="text-sm!">
                What is wrong? (optional)
              </label>
              <textarea id="abuse-reason" name="reason" rows={5} />
            </div>
            <div className="ff-field">
              <label htmlFor="abuse-contact" className="text-sm!">
                Your email (optional — only so we can follow up)
              </label>
              <input id="abuse-contact" name="contact" type="email" />
            </div>

            {/* One ultramarine primary action; cancel is a ghost escape hatch
                back to the site home. Primary reads first on mobile. */}
            <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center">
              <a href="/" className={`${BTN_GHOST} w-full sm:w-auto`}>
                Cancel
              </a>
              <button type="submit" className={`${BTN_PRIMARY} w-full sm:w-auto`}>
                <Icon name="mail" size={16} />
                Send report
              </button>
            </div>
          </form>
        </section>

        <p className="mt-8 max-w-[52ch] text-[0.8125rem] leading-[1.7] text-[var(--ff-muted)]">
          Abuse reports are reviewed by the FormForge team; violating documents are archived and
          removed from caches and search indexes. See our{" "}
          <a
            href="/dpa"
            className="font-medium text-[var(--ff-primary)] underline-offset-2 transition-colors hover:underline"
          >
            Data Processing Addendum
          </a>{" "}
          for how personal data on the platform is handled.
        </p>
      </article>
    </main>
  );
}
