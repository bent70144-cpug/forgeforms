// Shared kernel: AppError — one error class, one code set, one HTTP mapping (spec §4).
//
// Codes → HTTP: NOT_FOUND 404, FORBIDDEN 403, VALIDATION 422, CONFLICT 409,
// RATE_LIMITED 429, PLAN_LIMIT 402, INTERNAL 500.
//
// API error body shape (spec §4):
//   { "error": { "code": "VALIDATION", "message": "Invalid input",
//                "details": [{ "path": "blocks[2].props.title", "message": "Required" }] } }

import type { ZodError } from "zod";

export const APP_ERROR_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "PLAN_LIMIT",
  "INTERNAL",
  // SPEC-NOTE (T10): §4 has no code for unpublish; mapped to 410 by callers.
  "UNPUBLISHED",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Maps AppError codes to the HTTP status the API layer must respond with. */
export const HTTP_STATUS_BY_CODE: Readonly<Record<AppErrorCode, number>> = Object.freeze({
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
  INTERNAL: 500,
  UNPUBLISHED: 410,
});

/** Field-level detail, e.g. `{ path: "blocks[2].props.title", message: "Required" }`. */
export type ErrorDetail = { path?: string; message: string };

export type AppErrorResponseBody = {
  error: {
    code: AppErrorCode;
    message: string;
    details: readonly ErrorDetail[];
  };
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: readonly ErrorDetail[];

  constructor(code: AppErrorCode, message: string, details: readonly ErrorDetail[] = []) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  /** Duck-typed guard for cross-boundary catches (never `instanceof` across dupes). */
  static is(error: unknown): error is AppError {
    return error instanceof Error && error.name === "AppError" && "code" in error;
  }

  /** HTTP status for API responses (spec §4 mapping). */
  get status(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }

  /** Body for the API error envelope. Never includes internals. */
  toResponseBody(): AppErrorResponseBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }

  static notFound(message = "Not found", details: ErrorDetail[] = []): AppError {
    return new AppError("NOT_FOUND", message, details);
  }

  static forbidden(message = "Forbidden", details: ErrorDetail[] = []): AppError {
    return new AppError("FORBIDDEN", message, details);
  }

  static validation(message = "Invalid input", details: ErrorDetail[] = []): AppError {
    return new AppError("VALIDATION", message, details);
  }

  static conflict(message = "Conflict", details: ErrorDetail[] = []): AppError {
    return new AppError("CONFLICT", message, details);
  }

  static rateLimited(message = "Too many requests", details: ErrorDetail[] = []): AppError {
    return new AppError("RATE_LIMITED", message, details);
  }

  static planLimit(message = "Plan limit reached", details: ErrorDetail[] = []): AppError {
    return new AppError("PLAN_LIMIT", message, details);
  }

  static internal(message = "Internal error", details: ErrorDetail[] = []): AppError {
    return new AppError("INTERNAL", message, details);
  }

  /** Convert a Zod validation failure into a VALIDATION AppError (spec §4 body). */
  static fromZodError(error: ZodError, message = "Invalid input"): AppError {
    return new AppError(
      "VALIDATION",
      message,
      error.issues.map((issue) => ({ path: formatZodPath(issue.path), message: issue.message })),
    );
  }
}

/** `["blocks", 2, "props", "title"]` → `"blocks[2].props.title"` (spec §4 example). */
export function formatZodPath(path: PropertyKey[]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number" || /^\d+$/.test(String(segment))) {
      out += `[${String(segment)}]`;
    } else {
      out += out.length === 0 ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
}

export function toHttpStatus(code: AppErrorCode): number {
  return HTTP_STATUS_BY_CODE[code];
}
