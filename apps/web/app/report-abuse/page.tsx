// T29 (spec §17): "Report abuse" page — destination of the Report-abuse link
// rendered on every public page (/p/*, custom-host renders, /embed/*).
//
// Deliberately minimal and dependency-free: a static explanation + a form that
// POSTs to /api/public/abuse-report (no PII requested beyond the form's own
// reference; the report is written to the server log for staff review).
// form-action is covered by the public-page CSP ('self').
type ReportAbuseProps = { searchParams: Promise<{ document?: string }> };

export default async function ReportAbusePage({ searchParams }: ReportAbuseProps) {
  const params = await searchParams;
  const documentRef = typeof params.document === "string" ? params.document : "";

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.25rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Report abuse</h1>
      <p>
        If a form or page hosted on FormForge collects prohibited content (for example
        card numbers, passwords or government identifiers), impersonates you, or is used
        for spam or phishing, tell us and our team will take it down.
      </p>
      {documentRef ? (
        <p>
          Reporting document:{" "}
          <code data-testid="report-document-ref">{documentRef}</code>
        </p>
      ) : (
        <p>
          Tip: every public FormForge page carries a “Report abuse” link that prefills
          the document reference automatically.
        </p>
      )}

      <form action="/api/public/abuse-report" method="post" style={{ display: "grid", gap: "0.75rem", marginTop: "1.5rem" }}>
        <label>
          Document link or reference (required)
          <input
            name="documentRef"
            required
            defaultValue={documentRef}
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </label>
        <label>
          What is wrong? (optional)
          <textarea name="reason" rows={4} style={{ width: "100%", padding: "0.5rem" }} />
        </label>
        <label>
          Your email (optional — only so we can follow up)
          <input name="contact" type="email" style={{ width: "100%", padding: "0.5rem" }} />
        </label>
        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Send report
        </button>
      </form>

      <p style={{ marginTop: "2rem", fontSize: "0.9rem", color: "#555" }}>
        Abuse reports are reviewed by the FormForge team; violating documents are archived
        and removed from caches and search indexes. See our Data Processing Addendum
        (“/dpa”) for how personal data on the platform is handled.
      </p>
    </main>
  );
}
