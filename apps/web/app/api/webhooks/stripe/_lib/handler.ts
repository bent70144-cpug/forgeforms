// apps/web/app/api/webhooks/stripe/_lib/handler.ts
// The webhook endpoint's pure logic, extracted so tests can drive it without
// Next. route.ts is a one-line adapter over `createStripeWebhookHandler`.
//
// Spec §13 / issue #23: verify signature → parse → apply idempotently by
// event id → always ack 200 for anything Stripe sent correctly, so it stops
// retrying deliveries we deliberately ignore.

import { AppError } from '@formforge/core/billing';
import type { Billing, ApplyOutcome } from '@formforge/core/billing';

export type WebhookDeps = {
  billing: Pick<Billing, 'handleStripeWebhook'>;
};

export type WebhookResult = {
  received: boolean;
  applied?: boolean;
  ignored?: boolean;
  duplicate?: boolean;
  workspaceId?: string | null;
  plan?: string;
};

/** Webhook-specific AppError → HTTP mapping (spec §4 body shape kept):
 * VALIDATION (bad signature / malformed body) → 400 — Stripe treats non-2xx
 * as retryable, which is what we want for tampered or replayed deliveries.
 * INTERNAL (e.g. STRIPE_WEBHOOK_SECRET unset) → 500. PLAN_LIMIT can never
 * reach this endpoint (webhook events are not user actions). */
export function webhookErrorStatus(error: AppError): number {
  if (error.code === 'INTERNAL') return 500;
  return 400;
}

export function errorBody(error: AppError): { error: { code: string; message: string; details: unknown } } {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}

export function createStripeWebhookHandler(deps: WebhookDeps) {
  return async function POST(request: Request): Promise<Response> {
    // Raw body is REQUIRED — the HMAC is computed over the exact bytes
    // Stripe sent, so no JSON re-serialization anywhere before verification.
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('stripe-signature') ?? '';

    const result = await deps.billing.handleStripeWebhook({ rawBody, signatureHeader });

    if (!result.ok) {
      return Response.json(errorBody(result.error), {
        status: webhookErrorStatus(result.error),
      });
    }

    const outcome: ApplyOutcome = result.value;
    const body: WebhookResult = {
      received: true,
      applied: outcome.applied,
      ignored: outcome.ignored,
      duplicate: outcome.duplicate,
      workspaceId: outcome.workspaceId,
      ...(outcome.plan !== undefined ? { plan: outcome.plan } : {}),
    };
    return Response.json(body, { status: 200 });
  };
}
