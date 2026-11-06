import type { Metadata } from "next";
import { Icon } from "@/components/ui/icons";
import { BANNER_ERROR, BANNER_SUCCESS, BTN_PRIMARY } from "@/lib/ui";

// "Report abuse" page (spec §17) — destination of the Report-abuse link
// rendered on every public page (/p/*, custom-host renders, /embed/*). Lives in
// the (marketing) group so it inherits the public chrome; the URL is unchanged.
//
// Deliberately dependency-free: a static explanation + a form that POSTs to
// /api/public/abuse-report (no PII requested beyond the form's own reference;
// the report is written to the server log for staff review). form-action is
// covered by the public-page CSP ('self').

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
    <article className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">
        Report abuse
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ff-muted)]">
        If a form or page hosted on FormForge collects prohibited content (for example card numbers,
        passwords or government identifiers), impersonates you, or is used for spam or phishing, tell
        us and our team will take it down.
      </p>

      {documentRef ? (
        <p className="mt-4 text-sm text-[var(--ff-muted)]">
          Reporting document:{" "}
          <code
            data-testid="report-document-ref"
            className="break-all rounded-[10px] border border-[var(--ff-border)] bg-[var(--ff-card)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--ff-fg)]"
          >
            {documentRef}
          </code>
        </p>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-[var(--ff-muted)]">
          Tip: every public FormForge page carries a “Report abuse” link that prefills the document
          reference automatically.
        </p>
      )}

      {submitted ? (
        <p role="status" className={`${BANNER_SUCCESS} mt-6`}>
          Thank you — your report was received and will be reviewed by the FormForge team.
        </p>
      ) : null}
      {rateLimited ? (
        <p role="alert" className={`${BANNER_ERROR} mt-6`}>
          Too many reports sent from your network just now — please wait a minute and try again.
        </p>
      ) : null}
      {errored ? (
        <p role="alert" className={`${BANNER_ERROR} mt-6`}>
          That report couldn’t be accepted — check the document reference and try again.
        </p>
      ) : null}

      <form action="/api/public/abuse-report" method="post" className="ff-panel mt-8 space-y-4 p-6">
        <div className="ff-field">
          <label htmlFor="abuse-document-ref">Document link or reference (required)</label>
          <input id="abuse-document-ref" name="documentRef" required defaultValue={documentRef} />
        </div>
        <div className="ff-field">
          <label htmlFor="abuse-reason">What is wrong? (optional)</label>
          <textarea id="abuse-reason" name="reason" rows={5} />
        </div>
        <div className="ff-field">
          <label htmlFor="abuse-contact">Your email (optional — only so we can follow up)</label>
          <input id="abuse-contact" name="contact" type="email" />
        </div>

        <div className="pt-1">
          <button type="submit" className={BTN_PRIMARY}>
            <Icon name="mail" size={16} />
            Send report
          </button>
        </div>
      </form>

      <p className="mt-8 text-xs leading-relaxed text-[var(--ff-muted)]">
        Abuse reports are reviewed by the FormForge team; violating documents are archived and
        removed from caches and search indexes. See our{" "}
        <a
          href="/dpa"
          className="font-medium text-[var(--ff-fg)] underline decoration-current/30 underline-offset-2 transition hover:decoration-current"
        >
          Data Processing Addendum
        </a>{" "}
        for how personal data on the platform is handled.
      </p>
    </article>
  );
}
