// T29 (spec §17): "Report abuse" link on every public page.
//
// Server-safe (no client JS): an anchor to /report-abuse with the document
// reference prefilled, styled to stay unobtrusive. The abuse page itself
// explains what happens next and POSTs to /api/public/abuse-report.
//
// Styling is deliberately color-less: it uses currentColor + opacity (via a
// custom property so the hover state can lift opacity without an inline hover
// rule), so the link adapts to ANY document theme the renderer applies. The
// 12px flag glyph inherits the same strategy (inline SVG, currentColor, no
// emoji, no external asset) so the link keeps working on light and dark
// documents alike.
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
      className="inline-flex items-center gap-1.5 text-[13px] font-medium underline decoration-current/30 underline-offset-4 transition hover:decoration-current hover:[--ff-ra-opacity:0.9]"
      style={{ opacity: "var(--ff-ra-opacity, 0.55)" }}
      data-testid="report-abuse-link"
      rel="nofollow"
      // Inside the /embed iframe the report page must open outside the frame.
      target="_blank"
    >
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <path d="M4 22v-7" />
      </svg>
      Report abuse
    </a>
  );
}
