// Server-side session reader for server components (dashboard, settings…).
// Full validation (DB lookup + sliding expiry) happens here — the middleware
// only does a cheap cookie-presence check.
import { cookies } from "next/headers";
import { preAuthCtx, validateSession, type AuthenticatedSession } from "@formforge/core/identity";
import { SESSION_COOKIE_NAME } from "@/auth.config";
import { getIdentityDeps } from "./container";

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const result = await validateSession(preAuthCtx(), getIdentityDeps(), { token });
  return result.ok ? result.value : null;
}
