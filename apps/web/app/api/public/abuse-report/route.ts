// T29 (spec §17): public abuse-report intake backing /report-abuse.
//
// Postmark-only endpoint (202 Accepted): appends a structured log line for the
// staff review flow. Deliberately stores NO free-text PII in any table — the
// document reference (an internal id/slug), the reporter-supplied contact
// (OPTIONAL, truncated) and nothing else reach the log. Rate limiting reuses
// the ingest limiter seam (same in-memory token bucket per IP).
import { InMemoryRateLimiter } from "@formforge/core/submissions";
import { handleApiError, JSON_MEDIA } from "@/app/api/v1/_lib/respond";
import { parseAbuseReport } from "@/lib/abuse/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MINUTE = 5;

// One bucket per server instance is acceptable for an abuse intake (the real
// deployment swaps in the Redis limiter with the ingest plane — same seam).
const limiter = new InMemoryRateLimiter();

export async function POST(req: Request): Promise<Response> {
  // No-JS form posts from /report-abuse get redirects back to the page; JSON
  // callers keep the structured API responses.
  const formPost = !(req.headers.get("content-type") ?? "").includes("application/json");
  const redirectTo = (query: string) =>
    new Response(null, {
      status: 303,
      headers: { location: new URL(`/report-abuse?${query}`, req.url).toString(), "cache-control": "no-store" },
    });

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!(await limiter.tryTake(`abuse:${ip}`, RATE_LIMIT_PER_MINUTE))) {
    if (formPost) return redirectTo("error=ratelimited");
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
    if (!parsed.ok) {
      if (formPost) return redirectTo("error=1");
      return handleApiError(parsed.error);
    }

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
    if (formPost) return redirectTo("submitted=1");
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "content-type": JSON_MEDIA, "cache-control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
