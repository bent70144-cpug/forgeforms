import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "./errors.js";
import { appEnvSchema, parseEnv } from "./env.js";

const validEnv: Record<string, string> = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/formforge",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "s".repeat(32),
  AUTH_SECRET: "a".repeat(32),
  LOG_LEVEL: "info",
};

describe("env validation (spec §5)", () => {
  it("accepts a valid minimal env and applies defaults", () => {
    const env = parseEnv(validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.PUBLIC_BASE_URL).toBe("http://localhost:3000");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.AI_MODEL).toBe("claude-sonnet-4-6");
  });

  it("accepts postgres:// and redis:// url schemes", () => {
    const env = parseEnv({ ...validEnv, DATABASE_URL: "postgres://u:p@db.internal:5432/ff" });
    expect(env.DATABASE_URL).toBe("postgres://u:p@db.internal:5432/ff");
  });

  it("fails fast when DATABASE_URL is missing or malformed", () => {
    const missing = { ...validEnv } as Record<string, string>;
    delete missing.DATABASE_URL;
    expect(() => parseEnv(missing)).toThrow(AppError);
    try {
      parseEnv({ ...validEnv, DATABASE_URL: "not-a-url" });
      expect.unreachable("should have thrown");
    } catch (cause) {
      expect(cause).toBeInstanceOf(AppError);
      if (cause instanceof AppError) {
        expect(cause.code).toBe("VALIDATION");
        expect(cause.details.some((d) => d.path === "DATABASE_URL")).toBe(true);
      }
    }
  });

  it("fails fast when secrets are too short (SESSION_SECRET / AUTH_SECRET)", () => {
    expect(() => parseEnv({ ...validEnv, SESSION_SECRET: "short" })).toThrow(AppError);
    expect(() => parseEnv({ ...validEnv, AUTH_SECRET: "s".repeat(31) })).toThrow(AppError);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => parseEnv({ ...validEnv, LOG_LEVEL: "loud" })).toThrow(AppError);
  });

  it("treats integration keys as optional (Stripe, Google, S3, Resend)", () => {
    const env = parseEnv(validEnv);
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it("collects multiple issues with field-level details", () => {
    try {
      parseEnv({});
      expect.unreachable("should have thrown");
    } catch (cause) {
      expect(cause).toBeInstanceOf(AppError);
      if (cause instanceof AppError) {
        const paths = cause.details.map((d) => d.path);
        for (const required of ["DATABASE_URL", "SESSION_SECRET", "AUTH_SECRET"]) {
          expect(paths).toContain(required);
        }
      }
    }
  });

  it("schema keeps the documented optional keys", () => {
    const keys = Object.keys(appEnvSchema.shape);
    for (const key of [
      "NEXT_PUBLIC_APP_URL",
      "PUBLIC_BASE_URL",
      "SESSION_SECRET",
      "DATABASE_URL",
      "REDIS_URL",
      "AUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "S3_BUCKET",
      "RESEND_API_KEY",
      "STRIPE_SECRET_KEY",
      "TURNSTILE_SECRET_KEY",
      "AI_MODEL",
    ]) {
      expect(keys).toContain(key);
    }
  });
});
