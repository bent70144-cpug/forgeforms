// T29 (spec §17): strict CSP on public pages — unit tests for the pure
// builder in lib/security/csp.ts. The middleware wires the result onto
// responses; verifying the policy strings here keeps the header behavior
// deterministic without booting Next.
import { describe, expect, it } from "vitest";
import {
  buildPublicPageCsp,
  classifyPublicPagePath,
  publicPageHeadersFor,
  publicSecurityHeaders,
} from "@/lib/security/csp";

describe("buildPublicPageCsp — static policy (ISR planes: /p/*, /_host/*, marketing)", () => {
  const csp = buildPublicPageCsp({ nonce: null, embed: false });

  it("locks default-src to 'self' and forbids objects", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("script-src allows only our origin, inline bootstrap and Turnstile — no arbitrary hosts", () => {
    const script = /script-src ([^;]+);/.exec(csp)![1]!;
    expect(script).toContain("'self'");
    expect(script).toContain("'unsafe-inline'");
    expect(script).toContain("https://challenges.cloudflare.com");
    // No nonce on the static policy (cached HTML would bake a stale one).
    expect(script).not.toContain("nonce-");
    expect(script).not.toContain("'strict-dynamic'");
  });

  it("frame-src is the exact sandboxed-embed allowlist (YouTube/Vimeo/Calendly + self)", () => {
    const frame = /frame-src ([^;]+);/.exec(csp)![1]!;
    expect(frame.split(" ").sort()).toEqual(
      [
        "'self'",
        "https://calendly.com",
        "https://player.vimeo.com",
        "https://www.youtube-nocookie.com",
        "https://www.youtube.com",
      ].sort(),
    );
    // No bare wildcard scheme source (an unknown embed host must die).
    expect(frame).not.toMatch(/(^|\s)https:(\s|$)/);
    expect(frame).not.toMatch(/\*/);
  });

  it("forbids framing from third parties on non-embed public pages", () => {
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors *");
  });
});

describe("buildPublicPageCsp — nonce policy (dynamic embed plane /embed/*)", () => {
  const csp = buildPublicPageCsp({ nonce: "n3b64==", embed: true });

  it("uses nonce + strict-dynamic (Next.js CSP guide pattern)", () => {
    const script = /script-src ([^;]+);/.exec(csp)![1]!;
    expect(script).toContain("'nonce-n3b64=='");
    expect(script).toContain("'strict-dynamic'");
    expect(script).toContain("'self'");
  });

  it("embed surfaces are frameable from any parent (that is their purpose)", () => {
    expect(csp).toContain("frame-ancestors *");
  });

  it("every nonce is unique per request (no policy reuse across responses)", () => {
    const a = buildPublicPageCsp({ nonce: "aaa", embed: true });
    const b = buildPublicPageCsp({ nonce: "bbb", embed: true });
    expect(a).not.toBe(b);
  });
});

describe("classifyPublicPagePath", () => {
  it("classifies public planes", () => {
    expect(classifyPublicPagePath("/p/my-form")).toEqual({ kind: "document" });
    expect(classifyPublicPagePath("/p/ws-slug/doc-slug")).toEqual({ kind: "document" });
    expect(classifyPublicPagePath("/embed/doc_123")).toEqual({ kind: "embed" });
    expect(classifyPublicPagePath("/embed")).toEqual({ kind: "embed" });
    expect(classifyPublicPagePath("/")).toEqual({ kind: "marketing" });
    expect(classifyPublicPagePath("/templates")).toEqual({ kind: "marketing" });
    expect(classifyPublicPagePath("/dpa")).toEqual({ kind: "marketing" });
    expect(classifyPublicPagePath("/report-abuse")).toEqual({ kind: "marketing" });
    expect(classifyPublicPagePath("/report-abuse/doc_1")).toEqual({ kind: "marketing" });
  });

  it("leaves non-public planes untouched (dashboard, auth, API, assets)", () => {
    expect(classifyPublicPagePath("/dashboard")).toEqual({ kind: null });
    expect(classifyPublicPagePath("/login")).toEqual({ kind: null });
    expect(classifyPublicPagePath("/api/v1/documents")).toEqual({ kind: null });
    expect(classifyPublicPagePath("/_host/index")).toEqual({ kind: null });
    // lookalike prefixes must not match
    expect(classifyPublicPagePath("/people")).toEqual({ kind: null });
    expect(classifyPublicPagePath("/embedded-fake")).toEqual({ kind: null });
  });
});

describe("publicPageHeadersFor (middleware seam)", () => {
  it("returns CSP + nosniff + referrer policy for public pages", () => {
    const headers = publicPageHeadersFor("/p/my-form", "nonce")!;
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("embed path gets the strict nonce policy + frame-ancestors *", () => {
    const headers = publicPageHeadersFor("/embed/doc_1", "abc123")!;
    expect(headers["content-security-policy"]).toContain("'nonce-abc123'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors *");
  });

  it("returns null for non-public paths (middleware must not touch them)", () => {
    expect(publicPageHeadersFor("/dashboard/settings", "n")).toBeNull();
    expect(publicPageHeadersFor("/api/public/ingest/submissions", "n")).toBeNull();
  });
});

describe("publicSecurityHeaders", () => {
  it("carries exactly the three hardening headers", () => {
    const headers = publicSecurityHeaders("default-src 'self'");
    expect(Object.keys(headers).sort()).toEqual(
      ["content-security-policy", "referrer-policy", "x-content-type-options"].sort(),
    );
  });
});
