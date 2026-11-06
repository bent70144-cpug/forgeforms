// Email verification link handler (ticket #5): GET /api/auth/verify-email?token=…
// consumes the single-use token, updates users.email_verified_at and
// redirects to the login page with a status flag. A GET link is the only
// email-client-safe transport; the mutation is the token consumption itself.
import { NextResponse, type NextRequest } from "next/server";
import { getIdentityDeps } from "@/lib/auth/container";
import { runVerifyEmailToken } from "@/lib/auth/recovery-flow";
import { getAuthRateLimiters } from "@/lib/auth/rate-limit";

function loginRedirect(params: Record<string, string>): NextResponse {
  const url = new URL("http://placeholder.local/login");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url.toString().replace("http://placeholder.local", ""));
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const result = await runVerifyEmailToken({
    deps: getIdentityDeps(),
    token,
    ip,
    limiter: getAuthRateLimiters().login, // reuse the tightest auth limiter for link floods
  });

  if (!result.ok) {
    return loginRedirect({ error: result.error.code === "RATE_LIMITED" ? "verify_rate_limited" : "verify_expired" });
  }
  return loginRedirect({ verified: "1" });
}
