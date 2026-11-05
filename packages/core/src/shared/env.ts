// Shared kernel: env — fail-fast environment validation (spec §5).
//
// "Fail fast on boot: validate env with Zod in packages/core/src/shared/env.ts."
//
// `parseEnv` is pure (takes a record) so tests can drive it without
// process.env mutation; `loadEnv` is the boot-time entrypoint.

import { z } from "zod";
import { AppError } from "./errors.ts";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Environment contract (spec §5). Required at boot: DATABASE_URL,
 * REDIS_URL, SESSION_SECRET, AUTH_SECRET. Integration keys (Stripe, Google,
 * S3, Resend, Turnstile) are optional — the features that need them check
 * for their own key at call time.
 */
export const appEnvSchema = z.object({
  // App
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),
  // Database / cache
  DATABASE_URL: z.url("DATABASE_URL must be a valid url"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  // Auth
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  // Logging
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  // Auth (OAuth)
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // Storage
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_PUBLIC_CDN_URL: z.url().optional(),
  // Email
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  // Billing
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  STRIPE_PRICE_BUSINESS: z.string().min(1).optional(),
  // Abuse
  TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  // AI (Phase M8)
  AI_MODEL: z.string().min(1).default("claude-sonnet-4-6"),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

/**
 * Validate a raw env record. Throws {@link AppError} (code VALIDATION,
 * field-level details) on any problem — boot must fail loudly.
 */
export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  const parsed = appEnvSchema.safeParse(input);
  if (!parsed.success) {
    throw AppError.fromZodError(parsed.error, "Invalid environment configuration");
  }
  return parsed.data;
}

/** Boot-time validation. Call once in each entrypoint (web, worker). */
export function loadEnv(input: Record<string, string | undefined> = process.env): AppEnv {
  return parseEnv(input);
}
