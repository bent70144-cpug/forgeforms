// T29 (spec §17): "Report abuse" link on every public page.
//
// Server-safe (no client JS): an anchor to /report-abuse with the document
// reference prefilled, styled to stay unobtrusive. The abuse page itself
// explains what happens next and POSTs to /api/public/abuse-report.
const REPORT_ABUSE_PATH = "/report-abuse";

export function reportAbuseHref(documentRef?: string | null): string {
  if (!documentRef) return REPORT_ABUSE_PATH;
  return `${REPORT_ABUSE_PATH}?document=${encodeURIComponent(documentRef)}`;
}

type ReportAbuseLinkProps = {
  /** Document id or slug — carried into the report so staff can act on it. */
  documentRef?: string | null;
};

export function ReportAbuseLink({ documentRef }: ReportAbuseLinkProps) {
  return (
    <a
      href={reportAbuseHref(documentRef)}
      className="ff-report-abuse"
      data-testid="report-abuse-link"
      rel="nofollow"
      // Inside the /embed iframe the report page must open outside the frame.
      target="_blank"
    >
      Report abuse
    </a>
  );
}
