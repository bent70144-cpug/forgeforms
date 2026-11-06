// Shared kernel: logger — structured JSON logging (pino), spec §4.
//
// - Always bind `requestId`, `workspaceId`, `documentId` when known.
// - NEVER log answer values, passwords, tokens (spec §4). Enforced with a
//   pino redaction denylist: matching keys are removed from every log line,
//   at any depth, before serialization. Unit-tested.
//
// Usage:
//   const log = createLogger({ requestId, workspaceId });
//   log.info({ event: "document.published", documentId }, "published");

import pino from "pino";

/**
 * Keys that must never appear in logs (flat key names, matched at any
 * nesting depth via wildcard redact paths). snake_case and camelCase
 * variants included on purpose.
 */
export const LOG_DENYLIST = [
  // credentials
  "password",
  "password_hash",
  "passwordHash",
  "current_password",
  "currentPassword",
  "new_password",
  "newPassword",
  // tokens & secrets
  "token",
  "token_hash",
  "tokenHash",
  "api_token",
  "apiToken",
  "secret",
  "secret_key",
  "secretKey",
  "authorization",
  "cookie",
  "set-cookie",
  // submission payloads — never log answer values
  "answer",
  "answers",
  "value",
  "values",
] as const;

export type LogDenylistKey = (typeof LOG_DENYLIST)[number];

/**
 * Expand a denylist into pino redact paths. For each key we cover:
 * the key itself, array elements, and one/two levels of nesting, e.g.
 * `password`, `req.body.password`, `webhook.secret`, `answers[*]`.
 * (fast-redact wildcards also match array indices, so `*.value` covers
 * `answers[0].value`.)
 */
export function buildRedactPaths(denylist: readonly string[] = LOG_DENYLIST): string[] {
  const paths: string[] = [];
  for (const key of denylist) {
    paths.push(
      key,
      `${key}[*]`,
      `*.${key}`,
      `*.${key}[*]`,
      `*.*.${key}`,
      `*.*.${key}[*]`,
    );
  }
  return paths;
}

/** Structured-log bindings every line carries when known (spec §4). */
export type LogBindings = {
  requestId?: string;
  workspaceId?: string;
  documentId?: string;
};

export type CreateLoggerOptions = {
  /** Defaults to `process.env.LOG_LEVEL` (validated elsewhere), then `info`. */
  level?: string;
  /** Destination override — tests capture logs through this. */
  stream?: pino.DestinationStream;
};

export type Logger = pino.Logger;

export function createLogger(bindings: LogBindings = {}, options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? process.env.LOG_LEVEL ?? "info";
  return pino({
    level,
    // Replace pino's pid/hostname base with our correlation bindings so
    // every line carries requestId/workspaceId/documentId when known.
    base: { ...bindings },
    redact: {
      paths: buildRedactPaths(),
      // Remove, don't censor, so secret values never reach the output.
      remove: true,
    },
  }, options.stream);
}
