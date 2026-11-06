// T18 (issue #18) — signed export links (spec §12: "email signed link (7-day expiry)").
//
// Token format:  <payloadB64url>.<expUnixSeconds>.<hmacB64url>
//   payload = JSON { exportId, key, jti }  (key = object-store key, jti = random nonce)
//   sig     = HMAC-SHA256(secret, "<payloadB64url>.<expUnixSeconds>")
//
// Not guessable: the HMAC requires the server secret; the random `jti` makes
// tokens unique per export even for identical payloads, so tokens cannot be
// replayed across exports or predicted. Verification is constant-time and
// rejects expired tokens with an explicit reason. Pure functions: the clock is
// injected (`now`), secrets are never logged or embedded in the token.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Default link TTL: 7 days (spec §12 + issue #18 acceptance criteria). */
export const EXPORT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

export type ExportTokenPayload = {
  /** Export job this link belongs to. */
  exportId: string;
  /** Object-store key the download handler must serve after verification. */
  key: string;
  /** Random per-token nonce — makes identical payloads produce distinct tokens. */
  jti: string;
};

export type ExportTokenVerifyResult =
  | { ok: true; payload: ExportTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

function hmacSha256(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signExportToken(
  payload: ExportTokenPayload,
  opts: { secret: string; now: Date; ttlSeconds?: number },
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const expiresAtSeconds =
    Math.floor(opts.now.getTime() / 1000) + (opts.ttlSeconds ?? EXPORT_LINK_TTL_SECONDS);
  const signature = hmacSha256(opts.secret, `${body}.${expiresAtSeconds}`).toString("base64url");
  return `${body}.${expiresAtSeconds}.${signature}`;
}

export function verifyExportToken(
  token: string,
  opts: { secret: string; now?: Date },
): ExportTokenVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [body, expiresPart, signature] = parts;
  if (!body || !expiresPart || !signature) return { ok: false, reason: "malformed" };

  const expected = hmacSha256(opts.secret, `${body}.${expiresPart}`);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isExportTokenPayload(payload)) return { ok: false, reason: "malformed" };

  const expiresAtSeconds = Number(expiresPart);
  if (!Number.isSafeInteger(expiresAtSeconds)) return { ok: false, reason: "malformed" };
  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (nowSeconds > expiresAtSeconds) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

function isExportTokenPayload(value: unknown): value is ExportTokenPayload {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.exportId === "string" &&
    record.exportId.length > 0 &&
    typeof record.key === "string" &&
    record.key.length > 0 &&
    typeof record.jti === "string" &&
    record.jti.length > 0
  );
}

/** Random nonce for `jti` — the only source of randomness in this module. */
export function newTokenNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Builds the download URL for a signed token.
 * INTEGRATION-DEBT: the handler for `GET /api/v1/exports/:token` (verify →
 * stream `payload.key` as text/csv) belongs to the API ticket — this module
 * only defines the canonical link shape.
 */
export function buildExportLink(opts: { baseUrl: string; token: string }): string {
  const base = opts.baseUrl.replace(/\/+$/, "");
  return `${base}/api/v1/exports/${opts.token}`;
}
