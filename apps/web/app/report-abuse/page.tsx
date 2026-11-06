// T29 (spec §17): "Report abuse" page — destination of the Report-abuse link
// rendered on every public page (/p/*, custom-host renders, /embed/*).
//
// Deliberately minimal and dependency-free: a static explanation + a form that
// POSTs to /api/public/abuse-report (no PII requested beyond the form's own
// reference; the report is written to the server log for staff review).
// form-action is covered by the public-page CSP ('self').
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
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">Report abuse</h1>
      <p className="mt-4 text-base leading-relaxed text-[var(--ff-fg)]">
        If a form or page hosted on FormForge collects prohibited content (for example
        card numbers, passwords or government identifiers), impersonates you, or is used
        for spam or phishing, tell us and our team will take it down.
      </p>
      {documentRef ? (
        <p className="mt-3 text-sm text-[var(--ff-muted)]">
          Reporting document:{" "}
          <code
            data-testid="report-document-ref"
            className="break-all rounded-[calc(var(--ff-radius)*0.5)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[var(--ff-fg)]"
          >
            {documentRef}
          </code>
        </p>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-[var(--ff-muted)]">
          Tip: every public FormForge page carries a “Report abuse” link that prefills
          the document reference automatically.
        </p>
      )}

      {submitted ? (
        <p className="ff-banner ff-banner-success mt-6" role="status">
          Thank you — your report was received and will be reviewed by the FormForge team.
        </p>
      ) : null}
      {rateLimited ? (
        <p className="ff-banner ff-banner-error mt-6" role="alert">
          Too many reports sent from your network just now — please wait a minute and try again.
        </p>
      ) : null}
      {errored ? (
        <p className="ff-banner ff-banner-error mt-6" role="alert">
          That report couldn’t be accepted — check the document reference and try again.
        </p>
      ) : null}

      <form action="/api/public/abuse-report" method="post" className="ff-form mt-8">
        <div className="ff-field">
          <label htmlFor="abuse-document-ref">Document link or reference (required)</label>
          <input id="abuse-document-ref" name="documentRef" required defaultValue={documentRef} />
        </div>
        <div className="ff-field">
          <label htmlFor="abuse-reason">What is wrong? (optional)</label>
          <textarea
            id="abuse-reason"
            name="reason"
            rows={4}
            className="w-full rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 py-2 text-[var(--ff-fg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ff-primary)]"
          />
        </div>
        <div className="ff-field">
          <label htmlFor="abuse-contact">Your email (optional — only so we can follow up)</label>
          <input id="abuse-contact" name="contact" type="email" />
        </div>

        <div className="mt-2 flex flex-col items-start gap-2">
          <button type="submit" className="ff-btn ff-btn-primary transition-colors">
            Send report
          </button>
          <p className="text-xs text-[var(--ff-muted)]">Your report goes to the FormForge team for review.</p>
        </div>
      </form>

      <p className="mt-10 text-sm leading-relaxed text-[var(--ff-muted)]">
        Abuse reports are reviewed by the FormForge team; violating documents are archived
        and removed from caches and search indexes. See our Data Processing Addendum
        (“/dpa”) for how personal data on the platform is handled.
      </p>
    </main>
  );
}
