// Webhook HTTP dispatcher — T17 (issue #17).
//
// Builds the signed POST request (pure) and performs delivery through an
// injected fetch so tests never touch the network. Outcome is a plain result
// (never throws for delivery failures): HTTP status, duration and error text
// land in the webhook_deliveries row recorded by the caller.
import { WEBHOOK_SIGNATURE_HEADER, buildSignatureHeader } from "./webhook-signer";

export type WebhookTarget = {
  id: string;
  url: string;
  secret: string;
};

export const WEBHOOK_USER_AGENT = "FormForge-Webhooks/1.0";
export const WEBHOOK_TIMEOUT_MS = 10_000;

export type WebhookRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

/** Pure: build the exact request bytes + headers for a delivery attempt. */
export function buildWebhookRequest(args: {
  target: WebhookTarget;
  body: string;
  timestampSeconds: number;
}): WebhookRequest {
  return {
    url: args.target.url,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": WEBHOOK_USER_AGENT,
      [WEBHOOK_SIGNATURE_HEADER]: buildSignatureHeader(args.target.secret, args.body, args.timestampSeconds),
    },
    body: args.body,
  };
}

export type DeliveryOutcome = {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
};

export type HttpPost = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Perform one delivery attempt. Injectable transport + timeout; delivery
 * failures are returned as a result, never thrown (job handler decides on
 * retry/disable).
 */
export async function deliverWebhook(args: {
  target: WebhookTarget;
  body: string;
  timestampSeconds: number;
  post: HttpPost;
  timeoutMs?: number;
}): Promise<DeliveryOutcome> {
  const request = buildWebhookRequest({
    target: args.target,
    body: args.body,
    timestampSeconds: args.timestampSeconds,
  });
  const timeoutMs = args.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: { ok: boolean; status: number };
    try {
      response = await args.post(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    return {
      ok: response.ok,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      error: response.ok ? null : `http ${response.status}`,
    };
  } catch (cause) {
    const message = (cause as Error)?.message ?? "unknown transport error";
    return {
      ok: false,
      statusCode: null,
      durationMs: Date.now() - startedAt,
      error: message.slice(0, 500),
    };
  }
}
