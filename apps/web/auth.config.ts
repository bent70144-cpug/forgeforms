// Auth/session configuration for the web app (ticket #3, M1).
//
// SPEC-NOTE: spec §1 pins Auth.js v5 (credentials + Google, Drizzle adapter).
// Auth.js v5's credentials provider is only compatible with JWT sessions (its
// database-session path resolves users through an `accounts` table, which the
// spec §6 data model does not have), while ticket #3 requires DB-backed
// sessions via a repository with an in-memory fake for tests. We therefore
// implement the session layer directly (opaque token in an httpOnly cookie +
// `sessions` table with sliding expiry) behind the same conceptual surface:
// the exports below mirror what an Auth.js `session` config would carry, so
// switching to Auth.js when Google OAuth lands (M1 follow-up) is mechanical.
// Imports only the dependency-free policy module — this file is part of the
// middleware (edge) bundle and must not pull node:crypto or the DB stack.
import { SESSION_MAX_AGE_MS } from "@formforge/core/identity/policy";

/** Cookie name — `ff_` prefix, not `authjs.`, to avoid clashing with a future Auth.js install. */
export const SESSION_COOKIE_NAME = "ff_session";

export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_MAX_AGE_MS / 1000);

/** httpOnly always; secure in production (M1 acceptance). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
