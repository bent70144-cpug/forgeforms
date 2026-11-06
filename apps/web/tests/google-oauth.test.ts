// Google OAuth plumbing (ticket #5 acceptance: "Google login … when
// GOOGLE_CLIENT_ID configured; button hidden when not").
import { afterEach, describe, expect, it } from "vitest";
import {
  appOriginFromEnv,
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  googleOAuthConfig,
  parseGoogleIdToken,
} from "@/lib/auth/google";

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function setEnv(overrides: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  return saved;
}

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "APP_URL"];

describe("googleOAuthConfig", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is null (button hidden) when GOOGLE_CLIENT_ID is unset", () => {
    Object.assign(saved, setEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }));
    expect(googleOAuthConfig("http://localhost:3000")).toBeNull();
  });

  it("builds the redirect URI from the origin when configured", () => {
    Object.assign(
      saved,
      setEnv({ GOOGLE_CLIENT_ID: "cid123", GOOGLE_CLIENT_SECRET: "secret456" }),
    );
    const config = googleOAuthConfig("https://app.example.com");
    expect(config).toEqual({
      clientId: "cid123",
      clientSecret: "secret456",
      redirectUri: "https://app.example.com/api/auth/callback/google",
    });
  });

  it("prefers an explicit GOOGLE_REDIRECT_URI and APP_URL origin", () => {
    Object.assign(
      saved,
      setEnv({
        GOOGLE_CLIENT_ID: "cid123",
        GOOGLE_CLIENT_SECRET: "secret456",
        GOOGLE_REDIRECT_URI: "https://exact.example.com/api/auth/callback/google",
        APP_URL: "https://env.example.com",
      }),
    );
    expect(appOriginFromEnv()).toBe("https://env.example.com");
    const config = googleOAuthConfig(); // no request origin available
    expect(config?.redirectUri).toBe("https://exact.example.com/api/auth/callback/google");
  });
});

describe("buildGoogleAuthorizeUrl", () => {
  it("carries client id, code flow, scope and state", () => {
    const url = new URL(
      buildGoogleAuthorizeUrl(
        { clientId: "cid", clientSecret: "sec", redirectUri: "https://app.test/cb" },
        "st4te",
      ),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("st4te");
  });
});

describe("parseGoogleIdToken", () => {
  it("maps the JWT payload to the GoogleProfile shape", () => {
    const idToken = `header.${base64urlJson({ email: "Greta@Example.com", email_verified: true, name: "Greta" })}.signature`;
    const profile = parseGoogleIdToken(idToken);
    if (!profile.ok) throw new Error(profile.error.message);
    // Email case is preserved here — signInWithGoogleProfile does the normalization.
    expect(profile.value).toEqual({ email: "Greta@Example.com", name: "Greta", emailVerified: true });
  });

  it("treats an unverified Google email as unverified", () => {
    const idToken = `h.${base64urlJson({ email: "someone@example.com", email_verified: false, name: "" })}.s`;
    const profile = parseGoogleIdToken(idToken);
    if (!profile.ok) throw new Error(profile.error.message);
    expect(profile.value.emailVerified).toBe(false);
    expect(profile.value.name).toBeNull();
  });

  it("rejects malformed tokens and missing emails", () => {
    expect(parseGoogleIdToken("not-a-jwt").ok).toBe(false);
    const noEmail = `h.${base64urlJson({ email_verified: true })}.s`;
    expect(parseGoogleIdToken(noEmail).ok).toBe(false);
  });
});

describe("exchangeGoogleCode", () => {
  const config = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app.test/cb" };

  it("exchanges the code and returns the parsed profile", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id_token: `h.${base64urlJson({ email: "greta@example.com", email_verified: true, name: "Greta" })}.s`,
      }),
    })) as unknown as typeof fetch;

    const profile = await exchangeGoogleCode(config, "auth-code", fetchImpl);
    if (!profile.ok) throw new Error(profile.error.message);
    expect(profile.value.email).toBe("greta@example.com");
    expect(profile.value.emailVerified).toBe(true);
  });

  it("surfaces token-endpoint failures as errors (no throw)", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch;
    const profile = await exchangeGoogleCode(config, "bad-code", fetchImpl);
    expect(profile.ok).toBe(false);
  });
});
