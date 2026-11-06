// Shared fixtures for worker tests.
import type { SubmissionCompletedEvent } from "@formforge/core/integrations";
import type { WebhookEndpointRow } from "../src/ports";

export const WORKSPACE_ID = "5f0a1a1e-0000-4000-8000-000000000001";
export const DOCUMENT_ID = "5f0a1a1e-0000-4000-8000-000000000002";
export const SUBMISSION_ID = "5f0a1a1e-0000-4000-8000-000000000003";
export const EVENT_ID = "5f0a1a1e-0000-4000-8000-000000000004";

/** Answer values that must never appear in emails or logs. */
export const SECRET_ANSWER = "super-secret-answer-value";

export function completedEvent(overrides: Partial<SubmissionCompletedEvent> = {}): SubmissionCompletedEvent {
  return {
    id: EVENT_ID,
    type: "submission.completed",
    occurredAt: "2026-11-06T10:00:00.000Z",
    workspaceId: WORKSPACE_ID,
    documentId: DOCUMENT_ID,
    data: {
      submissionId: SUBMISSION_ID,
      answers: { b1: { label: "Email", value: SECRET_ANSWER } },
      hidden: { utm_source: "newsletter" },
      variables: { score: 7 },
    },
    ...overrides,
  };
}

let endpointSeq = 0;

export function endpoint(overrides: Partial<WebhookEndpointRow> = {}): WebhookEndpointRow {
  endpointSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(endpointSeq).padStart(12, "0")}`,
    workspaceId: WORKSPACE_ID,
    documentId: DOCUMENT_ID,
    url: `https://consumer.example.com/hooks/${endpointSeq}`,
    secret: `whsec_endpoint_${endpointSeq}`,
    events: ["submission.completed"],
    enabled: true,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}
