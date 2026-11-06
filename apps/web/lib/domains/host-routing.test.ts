// Middleware Host→documentId seam (issue #24, spec §10.1 "GET * on custom
// hostname — middleware maps Host → documentId via routing table, rewrites to
// _host"). These are the pure helpers apps/web/middleware.ts composes; the
// middleware itself stays a thin wrapper so the edge-runtime logic is fully
// unit-testable without Next.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_PATH_PREFIXES,
  HOST_ROUTE_TTL_MS,
  appHostsFromEnv,
  createFetchHostRouteResolver,
  shouldAttemptHostRewrite,
} from "./host-routing";

describe("appHostsFromEnv", () => {
  it("always treats localhost + 127.0.0.1 as the app", () => {
    expect(appHostsFromEnv({})).toEqual(expect.arrayContaining(["localhost", "127.0.0.1"]));
  });

  it("adds the hostnames of NEXT_PUBLIC_APP_URL / PUBLIC_BASE_URL / VERCEL_URL", () => {
    const hosts = appHostsFromEnv({
      NEXT_PUBLIC_APP_URL: "https://app.formforge.app",
      PUBLIC_BASE_URL: "http://localhost:3000",
      VERCEL_URL: "formforge.vercel.app",
    });
    expect(hosts).toContain("app.formforge.app");
    expect(hosts).toContain("localhost");
    expect(hosts).toContain("formforge.vercel.app");
  });

  it("ignores invalid URLs in env instead of crashing the edge", () => {
    expect(() => appHostsFromEnv({ NEXT_PUBLIC_APP_URL: "not a url" })).not.toThrow();
  });
});

describe("shouldAttemptHostRewrite", () => {
  const appHosts = ["localhost", "app.formforge.app"];

  it("rewrites a foreign hostname on a page path (the custom-domain render case)", () => {
    expect(shouldAttemptHostRewrite("docs.customer.com", "/", appHosts)).toBe(true);
    expect(shouldAttemptHostRewrite("docs.customer.com", "/pricing", appHosts)).toBe(true);
    expect(shouldAttemptHostRewrite("Docs.Customer.com:8443", "/", appHosts)).toBe(true);
  });

  it("never rewrites the deployment's own hosts", () => {
    expect(shouldAttemptHostRewrite("localhost", "/", appHosts)).toBe(false);
    expect(shouldAttemptHostRewrite("app.formforge.app", "/", appHosts)).toBe(false);
  });

  it("never rewrites app-owned path prefixes (api, _host, _next, auth, embed, public plane)", () => {
    for (const prefix of APP_PATH_PREFIXES) {
      const path = prefix.endsWith("/") ? `${prefix}thing` : prefix;
      expect(shouldAttemptHostRewrite("docs.customer.com", path, appHosts)).toBe(false);
    }
  });

  it("rejects an empty Host header", () => {
    expect(shouldAttemptHostRewrite("", "/", appHosts)).toBe(false);
  });
});

describe("createFetchHostRouteResolver (middleware → node lookup)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the routed documentId for a verified hostname", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ documentId: "018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f71" }),
    );
    const resolve = createFetchHostRouteResolver("http://internal", fetchMock as unknown as typeof fetch);
    await expect(resolve("docs.customer.com:443")).resolves.toBe(
      "018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f71",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://internal/api/internal/host-route?host=docs.customer.com",
      expect.anything(),
    );
  });

  it("caches per normalized host within the TTL (one fetch for repeated requests)", async () => {
    const fetchMock = vi.fn(async () => Response.json({ documentId: "doc_1" }));
    const resolve = createFetchHostRouteResolver("http://internal", fetchMock as unknown as typeof fetch);
    await resolve("docs.customer.com");
    await resolve("docs.customer.com");
    await resolve("docs.customer.com:8080"); // same normalized host → cache hit
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => Response.json({ documentId: "doc_1" }));
      const resolve = createFetchHostRouteResolver("http://internal", fetchMock as unknown as typeof fetch);
      await resolve("docs.customer.com");
      vi.advanceTimersByTime(HOST_ROUTE_TTL_MS + 1);
      await resolve("docs.customer.com");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches null for unrouted/unverified hosts (they must never rewrite)", async () => {
    const fetchMock = vi.fn(async () => Response.json({ documentId: null }));
    const resolve = createFetchHostRouteResolver("http://internal", fetchMock as unknown as typeof fetch);
    await expect(resolve("pending.customer.com")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves to null when the node side is down — custom domains never 500 the edge", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const resolve = createFetchHostRouteResolver("http://internal", fetchMock as unknown as typeof fetch);
    await expect(resolve("docs.customer.com")).resolves.toBeNull();
    await expect(resolve("other.customer.com")).resolves.toBeNull();
  });

  it("skips the fetch entirely for garbage hosts", async () => {
    const fetchMock = vi.fn();
    const resolve = createFetchHostRouteResolver("http://internal", fetchMock as unknown as typeof fetch);
    await expect(resolve("   ")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
