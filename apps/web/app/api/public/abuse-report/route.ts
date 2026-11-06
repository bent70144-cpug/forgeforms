// T29 (spec §17): public abuse-report intake backing /report-abuse.
//
// Postmark-only endpoint (202 Accepted): appends a structured log line for the
// staff review flow. Deliberately stores NO free-text PII in any table — the
// document reference (an internal id/slug), the reporter-supplied contact
// (OPTIONAL, truncated) and nothing else reach the log. Rate limiting reuses
// the ingest limiter seam (same in-memory token bucket per IP).
import { AppError, err, ok, type Result } from "@formforge/core";
import { InMemoryRateLimiter } from "@formforge/core/submissions";
import { handleApiError, JSON_MEDIA } from "@/app/api/v1/_lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MINUTE = 5;

// One bucket per server instance is acceptable for an abuse intake (the real
// deployment swaps in the Redis limiter with the ingest plane — same seam).
const limiter = new InMemoryRateLimiter();

type AbuseReportInput = {
  documentRef?: unknown;
  reason?: unknown;
  contact?: unknown;
};

export type AbuseReportRecord = {
  documentRef: string;
  reasonLength: number;
  hasContact: boolean;
  reportedAt: string;
};

/** Pure: normalize + validate the report body (unit-tested). */
export function parseAbuseReport(input: unknown): Result<AbuseReportRecord, AppError> {
  const body = (typeof input === "object" && input !== null ? input : {}) as AbuseReportInput;
  const documentRef = typeof body.documentRef === "string" ? body.documentRef.trim() : "";
  if (documentRef.length === 0 || documentRef.length > 300) {
    return err(
      AppError.validation("A document link or reference is required", [
        { path: "documentRef", message: "1-300 characters" },
      ]),
    );
  }
  return ok({
    documentRef,
    reasonLength: typeof body.reason === "string" ? Math.min(body.reason.length, 2000) : 0,
    hasContact: typeof body.contact === "string" && body.contact.trim().length > 0,
    reportedAt: new Date().toISOString(),
  });
}

export async function POST(req: Request): Promise<Response> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!(await limiter.tryTake(`abuse:${ip}`, RATE_LIMIT_PER_MINUTE))) {
    return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many abuse reports; try again later" } }), {
      status: 429,
      headers: { "content-type": JSON_MEDIA, "retry-after": "60", "cache-control": "no-store" },
    });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let input: unknown;
    if (contentType.includes("application/json")) {
      input = await req.json();
    } else {
      // HTML form post from /report-abuse (no-JS path).
      const form = await req.formData();
      input = Object.fromEntries(form.entries());
    }
    const parsed = parseAbuseReport(input);
    if (!parsed.ok) return handleApiError(parsed.error);

    // Structured staff-review log. NEVER logs the reporter email or the free
    // text (spec §17: no PII sprawl) — only shapes/flags.
    console.info(
      JSON.stringify({
        level: "info",
        event: "abuse.reported",
        documentRef: parsed.value.documentRef,
        reasonLength: parsed.value.reasonLength,
        hasContact: parsed.value.hasContact,
        reportedAt: parsed.value.reportedAt,
      }),
    );
    // 202 Accepted: the report is queued for human review, not processed.
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "content-type": JSON_MEDIA, "cache-control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
