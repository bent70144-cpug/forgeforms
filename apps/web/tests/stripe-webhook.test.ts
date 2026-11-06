// tests: /api/webhooks/stripe HTTP layer — signature → parse → apply,
// status codes, idempotent replay (issue #23 acceptance), downgrade.
// The handler is Next-agnostic (route.ts is a one-line adapter), so these
// run as plain Request→Response unit tests with the fake gateway + an
// in-memory store (issue #23 hard rule: no Stripe SDK, no network).

import { describe, expect, it } from 'vitest';
import {
  buildStripeEvent,
  createBilling,
  createFakeStripeGateway,
  signStripeEvent,
  type BillingStore,
  type StripeEvent,
  type WorkspaceBillingRow,
} from '@formforge/core/billing';
import {
  createStripeWebhookHandler,
  webhookErrorStatus,
} from '../app/api/webhooks/stripe/_lib/handler';
import { AppError } from '@formforge/core/billing';

// -- in-memory BillingStore (mirrors packages/core billing service tests) ----

function makeStore(seed: Record<string, WorkspaceBillingRow> = {}) {
  const rows = new Map(Object.entries(seed));
  const processed = new Set<string>();
  const markProcessed: string[] = [];
  const store: BillingStore = {
    async getWorkspaceBilling(workspaceId) {
      return rows.get(workspaceId) ?? null;
    },
    async findWorkspaceIdByStripeCustomer(stripeCustomerId) {
      for (const row of rows.values()) {
        if (row.stripeCustomerId === stripeCustomerId) return row.workspaceId;
      }
      return null;
    },
    async setWorkspaceBilling(input) {
      if (!rows.has(input.workspaceId)) return false;
      rows.set(input.workspaceId, { ...input });
      return true;
    },
    async isEventProcessed(eventId) {
      return processed.has(eventId);
    },
    async markEventProcessed(input) {
      markProcessed.push(input.eventId);
      processed.add(input.eventId);
    },
    async countMembers() {
      return 1;
    },
    async getMonthlySubmissions() {
      return 0;
    },
  };
  return { store, rows, markProcessed };
}

const SECRET = 'whsec_test';
const NOW_MS = 1_700_000_000_000;

function makeBilling(store: BillingStore, options: { withoutSecret?: boolean } = {}) {
  return createBilling({
    store,
    stripe: createFakeStripeGateway(),
    prices: { pro: 'price_pro', business: 'price_business' },
    webhookSecret: options.withoutSecret ? undefined : SECRET,
    appUrl: 'https://app.test',
    now: () => new Date(NOW_MS),
  });
}

function signedRequest(event: StripeEvent, options: { timestampMs?: number } = {}) {
  const rawBody = JSON.stringify(event);
  const signature = signStripeEvent(rawBody, SECRET, options.timestampMs ?? NOW_MS);
  return new Request('https://app.test/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: rawBody,
  });
}

function checkoutEvent(workspaceId: string, plan: string, eventId = 'evt_checkout_1'): StripeEvent {
  return buildStripeEvent(
    'checkout.session.completed',
    {
      id: 'cs_1',
      mode: 'subscription',
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: { workspaceId, plan },
    },
    { id: eventId },
  );
}

async function post(handler: (request: Request) => Promise<Response>, event: StripeEvent) {
  const response = await handler(signedRequest(event));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('POST /api/webhooks/stripe', () => {
  it('200 + applies a signed checkout.session.completed', async () => {
    const { store, rows } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const handler = createStripeWebhookHandler({ billing: makeBilling(store) });

    const { status, body } = await post(handler, checkoutEvent('ws_1', 'pro'));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      received: true,
      applied: true,
      duplicate: false,
      workspaceId: 'ws_1',
      plan: 'pro',
    });
    expect(rows.get('ws_1')?.plan).toBe('pro');
  });

  it('ACCEPTANCE: replayed webhook is a 200 duplicate and updates the plan once', async () => {
    const { store, rows, markProcessed } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const handler = createStripeWebhookHandler({ billing: makeBilling(store) });

    const first = await post(handler, checkoutEvent('ws_1', 'pro'));
    const replay = await post(handler, checkoutEvent('ws_1', 'pro'));

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ applied: true });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ applied: false, duplicate: true });
    expect(rows.get('ws_1')?.plan).toBe('pro'); // exactly one transition
    expect(markProcessed).toEqual(['evt_checkout_1']);
  });

  it('400 on a tampered body (digest mismatch)', async () => {
    const { store } = makeStore();
    const handler = createStripeWebhookHandler({ billing: makeBilling(store) });
    const event = checkoutEvent('ws_1', 'pro');
    const rawBody = JSON.stringify(event);
    const signature = signStripeEvent(rawBody, SECRET, NOW_MS);

    const tampered = new Request('https://app.test/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: JSON.stringify({ ...event, id: 'evt_tampered' }),
    });
    const response = await handler(tampered);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
  });

  it('400 on a timestamp outside the replay tolerance', async () => {
    const { store } = makeStore();
    const handler = createStripeWebhookHandler({ billing: makeBilling(store) });
    const stale = signedRequest(checkoutEvent('ws_1', 'pro'), {
      timestampMs: NOW_MS - 3_600_000, // 1h old, tolerance is 300s
    });
    const response = await handler(stale);
    expect(response.status).toBe(400);
  });

  it('200 + ignored for event types we do not handle', async () => {
    const { store } = makeStore();
    const handler = createStripeWebhookHandler({ billing: makeBilling(store) });
    const { status, body } = await post(
      handler,
      buildStripeEvent('invoice.paid', { id: 'in_1' }, { id: 'evt_other' }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ received: true, ignored: true, applied: false });
  });

  it('ACCEPTANCE: customer.subscription.deleted re-locks the workspace to free', async () => {
    const { store, rows } = makeStore({
      ws_1: {
        workspaceId: 'ws_1',
        plan: 'pro',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    });
    const handler = createStripeWebhookHandler({ billing: makeBilling(store) });

    const { status, body } = await post(
      handler,
      buildStripeEvent(
        'customer.subscription.deleted',
        { id: 'sub_1', customer: 'cus_1', status: 'canceled' },
        { id: 'evt_deleted_1' },
      ),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ applied: true, plan: 'free' });
    expect(rows.get('ws_1')?.plan).toBe('free');
    expect(rows.get('ws_1')?.stripeSubscriptionId).toBeNull();
  });

  it('500 INTERNAL when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    const { store } = makeStore();
    const handler = createStripeWebhookHandler({
      billing: makeBilling(store, { withoutSecret: true }),
    });
    const { status, body } = await post(handler, checkoutEvent('ws_1', 'pro'));
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: { code: 'INTERNAL' } });
  });
});

describe('webhookErrorStatus mapping', () => {
  it('maps VALIDATION→400 and INTERNAL→500; PLAN_LIMIT is unreachable here', () => {
    expect(webhookErrorStatus(new AppError('VALIDATION', 'bad signature'))).toBe(400);
    expect(webhookErrorStatus(new AppError('INTERNAL', 'no secret'))).toBe(500);
  });
});
