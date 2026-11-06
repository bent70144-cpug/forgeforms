import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EXPORT_LINK_TTL_SECONDS,
  buildExportLink,
  newTokenNonce,
  signExportToken,
  verifyExportToken,
  type ExportTokenPayload,
} from "./tokens";

const SECRET = "test-secret-do-not-commit";
const NOW = new Date("2026-11-05T12:00:00.000Z");
const PAYLOAD: ExportTokenPayload = {
  exportId: "018f0000-0000-7000-8000-000000000001",
  key: "exports/ws1/doc1/exp1.csv",
  jti: "a".repeat(32),
};

describe("signExportToken / verifyExportToken", () => {
  it("round-trips: verify returns the original payload", () => {
    const token = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    const result = verifyExportToken(token, { secret: SECRET, now: NOW });
    expect(result).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("defaults the TTL to 7 days and honours it exactly (issue #18 TTL test)", () => {
    const token = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    const withinTtl = new Date(NOW.getTime() + (EXPORT_LINK_TTL_SECONDS - 1) * 1000);
    const pastTtl = new Date(NOW.getTime() + (EXPORT_LINK_TTL_SECONDS + 1) * 1000);
    expect(EXPORT_LINK_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(verifyExportToken(token, { secret: SECRET, now: withinTtl }).ok).toBe(true);
    const expired = verifyExportToken(token, { secret: SECRET, now: pastTtl });
    expect(expired).toEqual({ ok: false, reason: "expired" });
  });

  it("honours a custom TTL", () => {
    const token = signExportToken(PAYLOAD, { secret: SECRET, now: NOW, ttlSeconds: 60 });
    expect(verifyExportToken(token, { secret: SECRET, now: new Date(NOW.getTime() + 59_000) }).ok).toBe(true);
    expect(verifyExportToken(token, { secret: SECRET, now: new Date(NOW.getTime() + 61_000) })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("embeds the expiry as unix seconds in the token", () => {
    const token = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    const expiresPart = token.split(".")[1];
    expect(Number(expiresPart)).toBe(Math.floor(NOW.getTime() / 1000) + EXPORT_LINK_TTL_SECONDS);
  });

  it("rejects tampered payload/signature as bad_signature", () => {
    const token = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    const [body, exp, sig] = token.split(".");
    // flip a character in the payload body
    const tamperedBody = `x${body?.slice(1) ?? ""}`;
    expect(verifyExportToken(`${tamperedBody}.${exp}.${sig}`, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    // flip a character in the signature
    const tamperedSig = `x${sig?.slice(1) ?? ""}`;
    expect(verifyExportToken(`${body}.${exp}.${tamperedSig}`, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects tokens signed with a different secret (not guessable)", () => {
    const token = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    expect(verifyExportToken(token, { secret: "another-secret", now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("never embeds the secret or plaintext payload in the token", () => {
    const token = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    expect(token).not.toContain(SECRET);
    expect(token).not.toContain(PAYLOAD.key);
    expect(token).not.toContain(PAYLOAD.exportId);
  });

  it("is deterministic for a fixed jti (the service injects newTokenNonce per export)", () => {
    const a = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    const b = signExportToken(PAYLOAD, { secret: SECRET, now: NOW });
    expect(a).toBe(b);
    // different nonce → different token, both valid
    const other = signExportToken({ ...PAYLOAD, jti: "b".repeat(32) }, { secret: SECRET, now: NOW });
    expect(other).not.toBe(a);
    expect(verifyExportToken(a, { secret: SECRET, now: NOW }).ok).toBe(true);
    expect(verifyExportToken(other, { secret: SECRET, now: NOW }).ok).toBe(true);
  });

  it("newTokenNonce is random (128-bit)", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newTokenNonce()));
    expect(nonces.size).toBe(50);
  });

  it("rejects properly-signed tokens whose payload is not a valid shape (malformed)", () => {
    const forged = (body: string): string => {
      const expiresAtSeconds = "9999999999";
      const signature = createHmac("sha256", SECRET).update(`${body}.${expiresAtSeconds}`).digest().toString("base64url");
      return `${body}.${expiresAtSeconds}.${signature}`;
    };
    // valid signature, invalid JSON
    expect(verifyExportToken(forged(Buffer.from("not json").toString("base64url")), { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
    // valid signature, payload missing required fields
    expect(
      verifyExportToken(forged(Buffer.from(JSON.stringify({ exportId: "e" })).toString("base64url")), {
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it.each([
    "",
    "not-a-token",
    "only.two",
    "a.b.c.d",
  ])("rejects structurally malformed token %j", (token) => {
    expect(verifyExportToken(token, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects structurally valid tokens with a bad signature before inspecting the payload", () => {
    // signature is checked first (constant-time) — payload validity is irrelevant
    const notJson = `${Buffer.from("not json").toString("base64url")}.9999999999.deadbeef`;
    const incomplete = `${Buffer.from(JSON.stringify({ exportId: "e" })).toString("base64url")}.9999999999.deadbeef`;
    expect(verifyExportToken(notJson, { secret: SECRET, now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyExportToken(incomplete, { secret: SECRET, now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("buildExportLink", () => {
  it("appends the token to the API path and strips trailing slashes", () => {
    expect(buildExportLink({ baseUrl: "https://app.example.com/", token: "t0k3n" })).toBe(
      "https://app.example.com/api/v1/exports/t0k3n",
    );
    expect(buildExportLink({ baseUrl: "http://localhost:3000", token: "t0k3n" })).toBe(
      "http://localhost:3000/api/v1/exports/t0k3n",
    );
  });
});
