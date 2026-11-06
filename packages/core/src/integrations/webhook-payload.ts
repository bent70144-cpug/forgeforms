// Webhook / event payload contract (spec §12 "Webhook payload & signature").
// Shared by T17 (worker fan-out + webhook delivery) and later T14 (ingest
// enqueue) — import from `@formforge/core/integrations`.
//
// SPEC-NOTE: the spec's payload shows `"id": "evt_…"`; until T02 lands the
// `shortId` helper, the id is an opaque string and T17 passes through whatever
// ingest provides (uuid v7 today, `evt_…` short id later).
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";;

export const SUBMISSION_COMPLETED_EVENT_TYPE = "submission.completed";

export type SubmissionCompletedEvent = {
  /** Event id — dedup/persistence key for the `events` table. */
  id: string;
  type: typeof SUBMISSION_COMPLETED_EVENT_TYPE;
  /** ISO-8601 timestamp of when the submission completed. */
  occurredAt: string;
  workspaceId: string;
  documentId: string;
  data: {
    submissionId: string;
    /**
     * Answer payload per block. NEVER logged (spec §4) — only signed and
     * delivered to subscribed webhook endpoints.
     */
    answers: Record<string, { label: string; value: unknown }>;
    hidden: Record<string, unknown>;
    variables: Record<string, unknown>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Runtime guard for queue payloads (jobs arrive from Redis as raw JSON). */
export function parseSubmissionCompletedEvent(input: unknown): Result<SubmissionCompletedEvent, AppError> {
  if (!isRecord(input)) return err(new AppError("VALIDATION", "event payload must be an object"));
  const id = asString(input.id);
  if (!id) return err(new AppError("VALIDATION", "event.id is required"));
  if (input.type !== SUBMISSION_COMPLETED_EVENT_TYPE) {
    return err(new AppError("VALIDATION", `event.type must be "${SUBMISSION_COMPLETED_EVENT_TYPE}"`));
  }
  const occurredAt = asString(input.occurredAt);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    return err(new AppError("VALIDATION", "event.occurredAt must be an ISO date string"));
  }
  const workspaceId = asString(input.workspaceId);
  if (!workspaceId) return err(new AppError("VALIDATION", "event.workspaceId is required"));
  const documentId = asString(input.documentId);
  if (!documentId) return err(new AppError("VALIDATION", "event.documentId is required"));
  if (!isRecord(input.data)) return err(new AppError("VALIDATION", "event.data must be an object"));
  const submissionId = asString(input.data.submissionId);
  if (!submissionId) return err(new AppError("VALIDATION", "event.data.submissionId is required"));
  const answers = input.data.answers;
  if (!isRecord(answers)) return err(new AppError("VALIDATION", "event.data.answers must be an object"));
  for (const [blockId, answer] of Object.entries(answers)) {
    if (!isRecord(answer) || typeof answer.label !== "string") {
      return err(new AppError("VALIDATION", `event.data.answers[${blockId}] must be { label, value }`));
    }
  }
  return ok({
    id,
    type: SUBMISSION_COMPLETED_EVENT_TYPE,
    occurredAt,
    workspaceId,
    documentId,
    data: {
      submissionId,
      answers: answers as SubmissionCompletedEvent["data"]["answers"],
      hidden: isRecord(input.data.hidden) ? input.data.hidden : {},
      variables: isRecord(input.data.variables) ? input.data.variables : {},
    },
  });
}

/**
 * Deterministic JSON with recursively sorted object keys. The webhook body
 * MUST be byte-stable across delivery attempts and replays (the signature is
 * computed over the exact bytes, and Postgres `jsonb` does not preserve key
 * order — so we never rely on plain JSON.stringify for bodies).
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  // BigInt etc. — unsupported in payloads.
  return "null";
}

/** Serialize an event into the exact webhook body bytes (stable across attempts/replays). */
export function serializeWebhookBody(event: SubmissionCompletedEvent): string {
  return canonicalJson(event);
}
