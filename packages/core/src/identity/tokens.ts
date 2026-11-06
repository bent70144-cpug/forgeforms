// Auth token plumbing for password reset + email verification (ticket #5,
// spec §12 `send-reset` / `send-verify`, spec §17).
//
// Token design (documented choice):
//   - Raw token = 32 random bytes, base64url — returned to the caller exactly
//     once and only ever embedded in the emailed link.
//   - At rest = sha256 hex of the raw token (same scheme as sessions and API
//     tokens). sha256 is accepted for high-entropy random tokens (the raw
//     secret is unguessable; a slow KDF would add nothing against DB-dump
//     attackers who already have the hash of a token that expires in ≤1h).
//   - Single use: `consumed_at` set atomically by the repository (compare-and-
//     set on `consumed_at IS NULL`).
//   - Password reset expiry: 1h (ticket acceptance). Verification expiry: 24h.
import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h (ticket #5 acceptance)
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h (documented choice)

export const RESET_EXPIRY_MINUTES = RESET_TOKEN_TTL_MS / 60_000;

export type AuthTokenKind = "password_reset" | "email_verify";

export const AUTH_TOKEN_KINDS: readonly AuthTokenKind[] = ["password_reset", "email_verify"];

export type AuthTokenRecord = {
  id: string;
  userId: string;
  kind: AuthTokenKind;
  /** sha256 hex of the raw token — the raw token never reaches storage. */
  tokenHash: string;
  expiresAt: Date;
  /** Set when consumed; single-use is enforced by the repository compare-and-set. */
  consumedAt: Date | null;
  createdAt: Date;
};

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashToken(rawToken: string): string {
  return sha256Hex(rawToken);
}

/** Opaque, unguessable token: 32 bytes of CSPRNG output, base64url. */
export function generateAuthToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Rendered auth email — same shape the integrations mailer consumes. */
export type RenderedAuthEmail = { subject: string; html: string; text: string };

/**
 * Email renderer port for auth flows. The core ships a dependency-free
 * fallback renderer; apps/web overrides it with the React Email templates
 * (lib/auth/emails.tsx) at the composition root.
 */
export interface AuthEmailRenderer {
  passwordReset(input: { url: string; expiresInMinutes: number }): RenderedAuthEmail;
  emailVerification(input: { url: string }): RenderedAuthEmail;
}
