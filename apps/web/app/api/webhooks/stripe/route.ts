// apps/web/app/api/webhooks/stripe/route.ts
// Stripe webhook endpoint (spec §13, issue #23). Thin adapter:
// env-built billing service ← _lib/billing-server.ts; logic ← _lib/handler.ts.
// Handles checkout.session.completed, customer.subscription.updated/deleted,
// invoice.payment_failed; verifies Stripe-Signature; idempotent by event id.

import { createStripeWebhookHandler } from './_lib/handler';
import { getBilling } from './_lib/billing-server';

export const runtime = 'nodejs'; // HMAC via node:crypto
export const dynamic = 'force-dynamic';

export const POST = createStripeWebhookHandler({ billing: getBilling() });
