// packages/mcp/src/validation.ts
// ISSUE #30: the retired src/bridge.ts carried its own DocumentBody Zod copy
// and validator. Canonical home now: @formforge/schema (document shape +
// zod issue formatting). This adapter keeps the MCP pipeline's kernel
// `Result<_, AppError>` contract.
//
// SPEC-NOTE: validation here is STRUCTURAL (DocumentBody shape, duplicate ids,
// settings/theme/logic) — matching the retired bridge validator exactly. The
// stricter registry-aware per-kind parse lives in @formforge/blocks
// (`parseDocument`); adopting it in the MCP apply_ops post-condition is
// tracked with the issue #30 follow-up.

import { AppError, type AppErrorDetail, type Result } from "@formforge/core";
import { DocumentBody, formatZodPath } from "@formforge/schema";
import { z } from "zod";

/** Structural DocumentBody validation surfaced as a kernel Result. */
export function validateDocumentBody(input: unknown): Result<DocumentBody, AppError> {
  const parsed = DocumentBody.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: new AppError(
      "VALIDATION",
      "Invalid DocumentBody",
      parsed.error.issues.map(
        (issue): AppErrorDetail => ({ path: formatZodPath(issue.path), message: issue.message }),
      ),
    ),
  };
}

/** Zod issues → spec §4 error details (dot/bracket paths). */
export function zodIssuesToDetails(error: z.ZodError): AppErrorDetail[] {
  return error.issues.map((issue) => ({ path: formatZodPath(issue.path), message: issue.message }));
}
