// T29 (spec §17): pure parsing for the public abuse-report intake.
// Kept out of route.ts — Next.js route files may only export handler fields.
import { AppError, err, ok, type Result } from "@formforge/core";

export type AbuseReportInput = {
  documentRef?: unknown;
  reason?: unknown;
  contact?: unknown;
};

export type AbuseReportRecord = {
  documentRef: string;
  reasonLength: number;
  hasContact: boolean;
  reportedAt: string;
};

/** Pure: normalize + validate the report body (unit-tested). */
export function parseAbuseReport(input: unknown): Result<AbuseReportRecord, AppError> {
  const body = (typeof input === "object" && input !== null ? input : {}) as AbuseReportInput;
  const documentRef = typeof body.documentRef === "string" ? body.documentRef.trim() : "";
  if (documentRef.length === 0 || documentRef.length > 300) {
    return err(
      AppError.validation("A document link or reference is required", [
        { path: "documentRef", message: "1-300 characters" },
      ]),
    );
  }
  return ok({
    documentRef,
    reasonLength: typeof body.reason === "string" ? Math.min(body.reason.length, 2000) : 0,
    hasContact: typeof body.contact === "string" && body.contact.trim().length > 0,
    reportedAt: new Date().toISOString(),
  });
}
