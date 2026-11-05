// Contract tests for the embed loader source (issue #22).
// The loader ships as a hand-written JS string (no bundler step), so these
// tests pin the properties the /embed docs promise: three modes, the ff:*
// protocol, strict origin checking, resize re-measure and idempotency.
import { describe, expect, it } from "vitest";

import { EMBED_LOADER_V1, EMBED_LOADER_VERSION } from "./loader";
import { GET, OPTIONS } from "./route";

describe("embed loader source", () => {
  it("is syntactically valid JavaScript (ES2017-compatible, no bundler step)", () => {
    expect(() => new Function(EMBED_LOADER_V1)).not.toThrow();
  });

  it("implements all three modes plus the documented aliases", () => {
    for (const mode of ["inline", "popup", "side-tab", "div", "full-page"]) {
      expect(EMBED_LOADER_V1).toContain(`"${mode}"`);
    }
  });

  it("speaks the full ff:* postMessage protocol", () => {
    for (const type of ["ff:ready", "ff:height", "ff:complete", "ff:request-height"]) {
      expect(EMBED_LOADER_V1).toContain(`"${type}"`);
    }
  });

  it("never posts to '*' — every postMessage uses the verified app origin", () => {
    expect(EMBED_LOADER_V1).not.toMatch(/postMessage\([^)]*['"]\*['"]/);
    expect(EMBED_LOADER_V1).toContain("appOrigin");
  });

  it("verifies incoming message origin and source before acting", () => {
    expect(EMBED_LOADER_V1).toContain("event.origin");
    expect(EMBED_LOADER_V1).toContain("byWindow.get(event.source)");
  });

  it("re-measures on window resize and closes overlays on Escape", () => {
    expect(EMBED_LOADER_V1).toContain('addEventListener("resize"');
    expect(EMBED_LOADER_V1).toContain('"Escape"');
  });

  it("is idempotent (double-injection guard) and exposes a scan() API", () => {
    expect(EMBED_LOADER_V1).toContain("__formForgeEmbedLoaded");
    expect(EMBED_LOADER_V1).toContain("scan:");
    expect(EMBED_LOADER_V1).toContain("data-ff-embed-ready");
  });

  it("frames point at /embed/:docId?mode=…&v=… with the pinned version", () => {
    expect(EMBED_LOADER_V1).toContain('"/embed/"');
    expect(EMBED_LOADER_V1).toContain('"?mode="');
    expect(EMBED_LOADER_V1).toContain('"&v="');
    expect(EMBED_LOADER_VERSION).toBe("v1");
  });
});

describe("embed loader route", () => {
  it("GET serves the loader as JavaScript with wildcard CORS + caching", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
    await expect(res.text()).resolves.toBe(EMBED_LOADER_V1);
  });

  it("OPTIONS answers CORS preflight without a body", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(res.text()).resolves.toBe("");
  });
});
