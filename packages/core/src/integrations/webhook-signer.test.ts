// HMAC signature tests — T17 (issue #17) acceptance:
// "Signature verified by a test consumer; tampered body rejected; stale
// timestamp (>5min) rejected". The main vector is stable and documented in
// webhook-signer.ts (cross-checked with openssl).
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  buildSignatureHeader,
  computeWebhookSignature,
  parseSignatureHeader,
  verifyWebhookSignature,
} from "./webhook-signer";

// Stable vector — DO NOT CHANGE (documented in webhook-signer.ts + verifiable
// via openssl; see file header comment).
const VECTOR_SECRET = "whsec_formforge_vector_1";
const VECTOR_BODY = '{"type":"submission.completed","id":"evt_vec_1"}';
const VECTOR_T = 1700000000;
const VECTOR_V1 = "62564b805dc79087da5aa508cc3b25992d8f7c7452e16575787543132c9e1220";

describe("computeWebhookSignature", () => {
  it("matches the pinned openssl-verified vector", () => {
    expect(computeWebhookSignature(VECTOR_SECRET, VECTOR_BODY, VECTOR_T)).toBe(VECTOR_V1);
  });

  it("is deterministic and secret-dependent", () => {
    const a = computeWebhookSignature(VECTOR_SECRET, VECTOR_BODY, VECTOR_T);
    const b = computeWebhookSignature(VECTOR_SECRET, VECTOR_BODY, VECTOR_T);
    expect(a).toBe(b);
    expect(computeWebhookSignature("whsec_other", VECTOR_BODY, VECTOR_T)).not.toBe(VECTOR_V1);
  });
});

describe("buildSignatureHeader", () => {
  it("emits the spec header format t=<unix>,v1=<hex>", () => {
    const header = buildSignatureHeader(VECTOR_SECRET, VECTOR_BODY, VECTOR_T);
    expect(header).toBe(`t=${VECTOR_T},v1=${VECTOR_V1}`);
    expect(header.startsWith("t=")).toBe(true);
    expect(header.split(",")[0]).toBe(`t=${VECTOR_T}`);
    expect(header.split(",")[1]).toBe(`v1=${VECTOR_V1}`);
  });
});

describe("parseSignatureHeader", () => {
  it("parses a well-formed header", () => {
    const parsed = parseSignatureHeader(`t=${VECTOR_T},v1=${VECTOR_V1}`);
    expect(parsed).toEqual({ timestampSeconds: VECTOR_T, signature: VECTOR_V1 });
  });

  it("rejects malformed headers", () => {
    expect(parseSignatureHeader("")).toBeNull();
    expect(parseSignatureHeader("t=abc,v1=nothex")).toBeNull();
    expect(parseSignatureHeader("v1=${VECTOR_V1}".replace("${VECTOR_V1}", VECTOR_V1))).toBeNull(); // missing t
    expect(parseSignatureHeader(`t=${VECTOR_T}`)).toBeNull(); // missing v1
    expect(parseSignatureHeader(`t=${VECTOR_T},v1=${"a".repeat(63)}`)).toBeNull(); // wrong length
  });
});

describe("verifyWebhookSignature (test consumer)", () => {
  const nowSeconds = VECTOR_T + 60;

  it("accepts a valid signature", () => {
    const header = buildSignatureHeader(VECTOR_SECRET, VECTOR_BODY, nowSeconds);
    expect(verifyWebhookSignature({ header, secret: VECTOR_SECRET, body: VECTOR_BODY, nowSeconds })).toEqual({
      ok: true,
      timestampSeconds: nowSeconds,
    });
  });

  it("rejects a tampered body with reason=mismatch", () => {
    const header = buildSignatureHeader(VECTOR_SECRET, VECTOR_BODY, nowSeconds);
    const tampered = VECTOR_BODY.replace("evt_vec_1", "evt_tamper");
    const result = verifyWebhookSignature({ header, secret: VECTOR_SECRET, body: tampered, nowSeconds });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a wrong secret with reason=mismatch", () => {
    const header = buildSignatureHeader("whsec_attacker", VECTOR_BODY, nowSeconds);
    expect(verifyWebhookSignature({ header, secret: VECTOR_SECRET, body: VECTOR_BODY, nowSeconds })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects a stale timestamp (>5min old) with reason=stale", () => {
    const staleT = nowSeconds - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS - 1;
    const header = buildSignatureHeader(VECTOR_SECRET, VECTOR_BODY, staleT);
    expect(verifyWebhookSignature({ header, secret: VECTOR_SECRET, body: VECTOR_BODY, nowSeconds })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("accepts a timestamp exactly at the tolerance boundary", () => {
    const edgeT = nowSeconds - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
    const header = buildSignatureHeader(VECTOR_SECRET, VECTOR_BODY, edgeT);
    expect(verifyWebhookSignature({ header, secret: VECTOR_SECRET, body: VECTOR_BODY, nowSeconds })).toEqual({
      ok: true,
      timestampSeconds: edgeT,
    });
  });

  it("rejects future-dated timestamps beyond the tolerance (replay hardening)", () => {
    const futureT = nowSeconds + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1;
    const header = buildSignatureHeader(VECTOR_SECRET, VECTOR_BODY, futureT);
    expect(verifyWebhookSignature({ header, secret: VECTOR_SECRET, body: VECTOR_BODY, nowSeconds })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("rejects malformed headers", () => {
    expect(verifyWebhookSignature({ header: "garbage", secret: VECTOR_SECRET, body: VECTOR_BODY, nowSeconds })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("exposes the canonical header name", () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe("X-FormForge-Signature");
  });
});
