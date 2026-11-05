// apps/web/app/api/public/ingest/_lib/http.ts
// HTTP plumbing for the public ingest routes: spec §4 error mapping, payload
// cap, request-id context, client IP and Idempotency-Key extraction.

import { AppError, type AppErrorCode, type ErrorDetail } from "@formforge/core/bridge";
import {
  payloadSizeError,
  type AnswerInput,
  type IngestRequestCtx,
} from "@formforge/core/submissions";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNPUBLISHED: 410,
  UNAUTHENTICATED: 401,
  UNPROCESSABLE: 422,
  AI_OUTPUT_INVALID: 502,
  AI_PROVIDER_ERROR: 502,
  AI_NOT_CONFIGURED: 503,
  CONFIRMATION_REQUIRED: 422,
  PLAN_LIMIT: 402,
  INTERNAL: 500,
};

/** Map AppError → HTTP response with the spec §4 error body shape. */
export function errorResponse(error: AppError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message, details: error.details ?? [] } },
    { status: STATUS_BY_CODE[error.code] ?? 500 },
  );
}

export function validationResponse(details: ErrorDetail[]): Response {
  return errorResponse(new AppError("VALIDATION", "Invalid input", details));
}

export function internalErrorResponse(): Response {
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal server error", details: [] } },
    { status: 500 },
  );
}

export function logInternalError(requestId: string, error: unknown): void {
  // Structured logging lands with the T02 logger; never log answers/tokens.
  console.error(JSON.stringify({ level: "error", scope: "ingest", requestId, error: String(error) }));
}

/** Reads the JSON body enforcing the 256 KB payload cap (spec §10.3 Limits). */
export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 0) {
    const tooLarge = payloadSizeError(declared);
    if (tooLarge) return { ok: false, response: errorResponse(tooLarge) };
  }
  const text = await req.text();
  const tooLarge = payloadSizeError(Buffer.byteLength(text, "utf8"));
  if (tooLarge) return { ok: false, response: errorResponse(tooLarge) };
  if (text.trim() === "") return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: errorResponse(new AppError("VALIDATION", "Invalid JSON body")),
    };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function bodyRecord(
  payload: unknown,
): { ok: true; body: Record<string, unknown> } | { ok: false; response: Response } {
  if (!isRecord(payload)) {
    return { ok: false, response: validationResponse([{ path: "body", message: "JSON object expected" }]) };
  }
  return { ok: true, body: payload };
}

export function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function parseAnswers(
  value: unknown,
): { ok: true; answers: AnswerInput[] } | { ok: false; response: Response } {
  if (value === undefined || value === null) return { ok: true, answers: [] };
  if (!Array.isArray(value)) {
    return { ok: false, response: validationResponse([{ path: "answers", message: "answers must be an array" }]) };
  }
  const answers: AnswerInput[] = [];
  for (const [i, item] of value.entries()) {
    if (!isRecord(item)) {
      return { ok: false, response: validationResponse([{ path: `answers[${i}]`, message: "must be an object" }]) };
    }
    const blockId = item.blockId;
    if (typeof blockId !== "string" || blockId === "") {
      return { ok: false, response: validationResponse([{ path: `answers[${i}].blockId`, message: "blockId is required" }]) };
    }
    if (item.clientTs !== undefined && typeof item.clientTs !== "string") {
      return { ok: false, response: validationResponse([{ path: `answers[${i}].clientTs`, message: "clientTs must be a string" }]) };
    }
    answers.push({ blockId, value: item.value, clientTs: item.clientTs as string | undefined });
  }
  return { ok: true, answers };
}

/** First hop of x-forwarded-for, then x-real-ip, else "unknown". */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** `Idempotency-Key` header (spec §4), trimmed and length-capped. */
export function idempotencyKeyOf(req: Request): string | undefined {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return undefined;
  return key.slice(0, 200);
}

export function requestCtx(req: Request): IngestRequestCtx {
  return {
    requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
    actor: { type: "system", id: "public-ingest" },
    now: () => new Date(),
  };
}
