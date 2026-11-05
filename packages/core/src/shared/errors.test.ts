import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  APP_ERROR_CODES,
  AppError,
  HTTP_STATUS_BY_CODE,
  formatZodPath,
  toHttpStatus,
} from "./errors.ts";

describe("AppError", () => {
  it("exposes exactly the spec §4 code set", () => {
    expect(APP_ERROR_CODES).toEqual([
      "NOT_FOUND",
      "FORBIDDEN",
      "VALIDATION",
      "CONFLICT",
      "RATE_LIMITED",
      "PLAN_LIMIT",
      "INTERNAL",
    ]);
  });

  it("maps every code to its HTTP status (spec §4)", () => {
    // NOT_FOUND, FORBIDDEN, VALIDATION, CONFLICT, RATE_LIMITED, PLAN_LIMIT, INTERNAL
    // → 404, 403, 422, 409, 429, 402, 500
    expect(HTTP_STATUS_BY_CODE).toEqual({
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      VALIDATION: 422,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      PLAN_LIMIT: 402,
      INTERNAL: 500,
    });
    for (const code of APP_ERROR_CODES) {
      expect(toHttpStatus(code)).toBe(HTTP_STATUS_BY_CODE[code]);
    }
  });

  it("carries code, message, details and a status getter", () => {
    const e = new AppError("PLAN_LIMIT", "too many documents", [
      { path: "plan", message: "limit reached" },
    ]);
    expect(e.code).toBe("PLAN_LIMIT");
    expect(e.message).toBe("too many documents");
    expect(e.details).toEqual([{ path: "plan", message: "limit reached" }]);
    expect(e.status).toBe(402);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AppError");
  });

  it("serializes to the spec §4 API error body", () => {
    const e = AppError.validation("Invalid input", [
      { path: "blocks[2].props.title", message: "Required" },
    ]);
    expect(e.toResponseBody()).toEqual({
      error: {
        code: "VALIDATION",
        message: "Invalid input",
        details: [{ path: "blocks[2].props.title", message: "Required" }],
      },
    });
  });

  it("constructor helpers set the right codes", () => {
    expect(AppError.notFound().code).toBe("NOT_FOUND");
    expect(AppError.forbidden().code).toBe("FORBIDDEN");
    expect(AppError.validation().code).toBe("VALIDATION");
    expect(AppError.conflict().code).toBe("CONFLICT");
    expect(AppError.rateLimited().code).toBe("RATE_LIMITED");
    expect(AppError.planLimit().code).toBe("PLAN_LIMIT");
    expect(AppError.internal().code).toBe("INTERNAL");
  });

  it("fromZodError maps zod issues into field-level details", () => {
    const schema = z.object({
      blocks: z.array(z.object({ props: z.object({ title: z.string() }) })),
    });
    const parsed = schema.safeParse({ blocks: [{ props: {} }] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const e = AppError.fromZodError(parsed.error);
    expect(e.code).toBe("VALIDATION");
    expect(e.status).toBe(422);
    expect(e.details[0]?.path).toBe("blocks[0].props.title");
    expect(e.details[0]?.message).toBeTruthy();
  });

  it("formatZodPath renders root-level and nested paths", () => {
    expect(formatZodPath([])).toBe("");
    expect(formatZodPath(["title"])).toBe("title");
    expect(formatZodPath(["blocks", 2, "props", "title"])).toBe("blocks[2].props.title");
    expect(formatZodPath(["a", "0", "b"])).toBe("a[0].b");
  });
});
