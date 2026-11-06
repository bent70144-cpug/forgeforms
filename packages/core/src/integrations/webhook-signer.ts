// Webhook HMAC-SHA256 signing (spec §12) — T17 (issue #17).
//
// Header format (pinned by spec + issue #17):
//   X-FormForge-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, t + "." + body)>
// Consumers reject payloads whose timestamp is older than 5 minutes.
//
// Stable test vector (pinned in webhook-signer.test.ts, cross-checked with
// openssl). Verify by hand:
//   printf '%s' '1700000000.{"type":"submission.completed","id":"evt_vec_1"}' \
//     | openssl dgst -sha256 -hmac 'whsec_formforge_vector_1'
//   → 62564b805dc79087da5aa508cc3b25992d8f7c7452e16575787543132c9e1220
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_HEADER = "X-FormForge-Signature";

/** Consumers reject timestamps older than this (spec §12: 5 minutes). */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Constant-time hex comparison of two equal-length digests. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** `hmac_sha256(secret, t + "." + body)` as lowercase hex. Pure. */
export function computeWebhookSignature(secret: string, body: string, timestampSeconds: number): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
}

/** Build the full `X-FormForge-Signature` header value. Pure. */
export function buildSignatureHeader(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${computeWebhookSignature(secret, body, timestampSeconds)}`;
}

export type ParsedSignatureHeader = { timestampSeconds: number; signature: string };

/** Parse `t=…,v1=…`; returns null on any malformed input (never throws). */
export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let t: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") t = value;
    else if (key === "v1") v1 = value;
  }
  if (t === undefined || v1 === undefined) return null;
  const timestampSeconds = Number(t);
  if (!Number.isInteger(timestampSeconds) || timestampSeconds < 0) return null;
  if (!/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { timestampSeconds, signature: v1.toLowerCase() };
}

export type SignatureVerifyFailure = "malformed" | "stale" | "mismatch";

export type SignatureVerifyResult =
  | { ok: true; timestampSeconds: number }
  | { ok: false; reason: SignatureVerifyFailure };

/**
 * Verify a webhook signature the way a consumer would. Pure.
 *
 * SPEC-NOTE: spec §12 says "consumers reject if timestamp older than 5
 * minutes"; we additionally reject timestamps too far in the future (same
 * tolerance) so a stolen header cannot be replayed forever — the acceptance
 * case (>5min stale → rejected) is covered either way.
 */
export function verifyWebhookSignature(args: {
  header: string;
  secret: string;
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): SignatureVerifyResult {
  const parsed = parseSignatureHeader(args.header);
  if (!parsed) return { ok: false, reason: "malformed" };
  const tolerance = args.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(args.nowSeconds - parsed.timestampSeconds) > tolerance) {
    return { ok: false, reason: "stale" };
  }
  const expected = computeWebhookSignature(args.secret, args.body, parsed.timestampSeconds);
  if (!safeEqualHex(expected, parsed.signature)) return { ok: false, reason: "mismatch" };
  return { ok: true, timestampSeconds: parsed.timestampSeconds };
}
