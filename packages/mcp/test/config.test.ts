import { describe, expect, it } from "vitest";
import { API_TOKEN_ENV_VAR, readApiToken } from "../src/config.ts";

describe("readApiToken", () => {
  it("reads --token <value>", () => {
    expect(readApiToken(["--token", "abc"], {})).toBe("abc");
  });

  it("reads --token=<value>", () => {
    expect(readApiToken(["--token=abc"], {})).toBe("abc");
  });

  it("falls back to the environment variable", () => {
    expect(readApiToken([], { [API_TOKEN_ENV_VAR]: "env-token" })).toBe("env-token");
  });

  it("prefers the CLI argument over the environment variable", () => {
    expect(readApiToken(["--token", "arg-token"], { [API_TOKEN_ENV_VAR]: "env-token" })).toBe(
      "arg-token",
    );
  });

  it("returns null when no token is configured", () => {
    expect(readApiToken([], {})).toBeNull();
    expect(readApiToken([], { [API_TOKEN_ENV_VAR]: "" })).toBeNull();
    expect(readApiToken(["--token"], {})).toBeNull();
  });
});
