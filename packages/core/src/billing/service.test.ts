// tests: createBilling service — webhook idempotency, workspace resolution,
// checkout/portal via the fake gateway, seats.
import { describe, expect, it } from 'vitest';
import { AppError } from "../shared/errors.ts";;
import { createBilling, type Billing } from './service';
import type { BillingStore, WorkspaceBillingRow } from './store';
import { buildStripeEvent, type StripeEvent } from './stripe/events';
import { createFakeStripeGateway } from './stripe/fake-gateway';
import { signStripeEvent } from './stripe/signature';

// -- in-memory BillingStore --------------------------------------------------

function makeStore(seed: Record<string, WorkspaceBillingRow> = {}) {
  const rows = new Map(Object.entries(seed));
  const processed = new Set<string>();
  const calls = {
    getWorkspaceBilling: [] as string[],
    setWorkspaceBilling: [] as string[],
    markEventProcessed: [] as string[],
  };
  const store: BillingStore & { rows: Map<string, WorkspaceBillingRow>; processed: Set<string> } = {
    rows,
    processed,
    async getWorkspaceBilling(workspaceId) {
      calls.getWorkspaceBilling.push(workspaceId);
      return rows.get(workspaceId) ?? null;
    },
    async findWorkspaceIdByStripeCustomer(stripeCustomerId) {
      for (const row of rows.values()) {
        if (row.stripeCustomerId === stripeCustomerId) return row.workspaceId;
      }
      return null;
    },
    async setWorkspaceBilling(input) {
      calls.setWorkspaceBilling.push(input.workspaceId);
      if (!rows.has(input.workspaceId)) return false;
      rows.set(input.workspaceId, {
        workspaceId: input.workspaceId,
        plan: input.plan,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
      });
      return true;
    },
    async isEventProcessed(eventId) {
      return processed.has(eventId);
    },
    async markEventProcessed(input) {
      calls.markEventProcessed.push(input.eventId);
      processed.add(input.eventId);
    },
    async countMembers(workspaceId) {
      const row = rows.get(workspaceId);
      return row ? (row as WorkspaceBillingRow & { members?: number }).members ?? 1 : 0;
    },
    async getMonthlySubmissions() {
      return 0;
    },
  };
  return { store, calls };
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

const PRICES = { pro: 'price_pro', business: 'price_business' };

function makeBilling(store: BillingStore, gateway = createFakeStripeGateway()): Billing {
  return createBilling({
    store,
    stripe: gateway,
    prices: PRICES,
    webhookSecret: 'whsec_test',
    appUrl: 'https://app.test',
    now: () => new Date(1_700_000_000_000),
  });
}

describe('applyStripeEvent — webhook application', () => {
  it('updates the workspace plan from checkout.session.completed', async () => {
    const { store, calls } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = makeBilling(store);
    const result = await billing.applyStripeEvent(
      checkoutEvent('ws_1', 'pro'),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.applied).toBe(true);
      expect(result.value.plan).toBe('pro');
    }
    expect(store.rows.get('ws_1')?.plan).toBe('pro');
    expect(store.rows.get('ws_1')?.stripeCustomerId).toBe('cus_1');
    expect(store.rows.get('ws_1')?.stripeSubscriptionId).toBe('sub_1');
    expect(calls.markEventProcessed).toEqual(['evt_checkout_1']);
  });

  it('ACCEPTANCE: webhook replayed twice updates plan once (idempotency)', async () => {
    const { store, calls } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = makeBilling(store);
    const event = checkoutEvent('ws_1', 'pro');

    const first = await billing.applyStripeEvent(event);
    const second = await billing.applyStripeEvent(event);

    expect(first.ok && first.value.applied).toBe(true);
    expect(second.ok && second.value.duplicate).toBe(true);
    expect(calls.setWorkspaceBilling).toHaveLength(1);
    expect(store.rows.get('ws_1')?.plan).toBe('pro');
  });

  it('resolves the workspace by Stripe customer id when metadata is missing', async () => {
    const { store } = makeStore({
      ws_1: {
        workspaceId: 'ws_1',
        plan: 'pro',
        stripeCustomerId: 'cus_known',
        stripeSubscriptionId: 'sub_old',
      },
    });
    const billing = makeBilling(store);
    const event = buildStripeEvent(
      'customer.subscription.deleted',
      { id: 'sub_old', customer: 'cus_known', status: 'canceled' },
      { id: 'evt_deleted_1' },
    );
    const result = await billing.applyStripeEvent(event);
    expect(result.ok && result.value.applied).toBe(true);
    expect(store.rows.get('ws_1')?.plan).toBe('free');
    expect(store.rows.get('ws_1')?.stripeSubscriptionId).toBeNull();
  });

  it('acks events for unknown workspaces without marking them processed', async () => {
    const { store, calls } = makeStore();
    const billing = makeBilling(store);
    const result = await billing.applyStripeEvent(checkoutEvent('ws_missing', 'pro'));
    expect(result.ok && result.value.applied).toBe(false);
    expect(calls.markEventProcessed).toHaveLength(0);
  });

  it('acks unhandled event types without touching the store', async () => {
    const { store, calls } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = makeBilling(store);
    const result = await billing.applyStripeEvent(
      buildStripeEvent('invoice.paid', { id: 'in_9' }, { id: 'evt_other' }),
    );
    expect(result.ok && result.value.ignored).toBe(true);
    expect(calls.setWorkspaceBilling).toHaveLength(0);
  });

  it('invalidates the entitlements cache when the plan changes (unlock within TTL)', async () => {
    const { store } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = makeBilling(store);
    // warm the cache
    await expect(billing.can('ws_1', 'removeBranding')).resolves.toBe(false);
    await billing.applyStripeEvent(checkoutEvent('ws_1', 'pro'));
    // cache was invalidated → next can() sees the new plan immediately
    await expect(billing.can('ws_1', 'removeBranding')).resolves.toBe(true);
  });

  it('ACCEPTANCE: downgrade re-locks capabilities', async () => {
    const { store } = makeStore({
      ws_1: {
        workspaceId: 'ws_1',
        plan: 'business',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    });
    const billing = makeBilling(store);
    await expect(billing.can('ws_1', 'removeBranding')).resolves.toBe(true);

    await billing.applyStripeEvent(
      buildStripeEvent(
        'customer.subscription.deleted',
        { id: 'sub_1', customer: 'cus_1', status: 'canceled' },
        { id: 'evt_del' },
      ),
    );
    await expect(billing.can('ws_1', 'removeBranding')).resolves.toBe(false);
    await expect(billing.can('ws_1', 'analytics')).resolves.toBe(false);
    await expect(billing.can('ws_1', 'customDomains')).resolves.toBe(false);
    expect(store.rows.get('ws_1')?.plan).toBe('free');
  });
});

describe('handleStripeWebhook — signature → parse → apply', () => {
  const rawBody = JSON.stringify(checkoutEvent('ws_1', 'pro'));

  it('fails closed when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    const { store } = makeStore();
    const billing = createBilling({ store, prices: PRICES });
    const result = await billing.handleStripeWebhook({ rawBody, signatureHeader: 't=1,v1=aa' });
    expect(!result.ok && result.error.code).toBe('INTERNAL');
  });

  it('rejects an invalid signature with VALIDATION (route maps to 400)', async () => {
    const { store } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = makeBilling(store);
    const result = await billing.handleStripeWebhook({
      rawBody,
      signatureHeader: 't=1700000000,v1=deadbeef',
    });
    expect(!result.ok && result.error.code).toBe('VALIDATION');
    expect(store.rows.get('ws_1')?.plan).toBe('free');
  });

  it('processes a correctly signed delivery end-to-end', async () => {
    const { store } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = makeBilling(store);
    const header = signStripeEvent(rawBody, 'whsec_test', 1_700_000_000_000);
    const result = await billing.handleStripeWebhook({ rawBody, signatureHeader: header });
    expect(result.ok && result.value.applied).toBe(true);
    expect(store.rows.get('ws_1')?.plan).toBe('pro');
  });

  it('maps malformed JSON to VALIDATION (not a crash)', async () => {
    const { store } = makeStore();
    const billing = makeBilling(store);
    const header = signStripeEvent('not-json', 'whsec_test', 1_700_000_000_000);
    const result = await billing.handleStripeWebhook({ rawBody: 'not-json', signatureHeader: header });
    expect(!result.ok && result.error.code).toBe('VALIDATION');
  });
});

describe('checkout & portal via the injected gateway', () => {
  it('startCheckout builds a session with default settings URLs', async () => {
    const { store } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'free', stripeCustomerId: 'cus_1', stripeSubscriptionId: null },
    });
    const gateway = createFakeStripeGateway();
    const billing = makeBilling(store, gateway);
    const ctx = {
      workspaceId: 'ws_1',
      actor: { type: 'user', id: 'u_1' },
      requestId: 'req_1',
      now: () => new Date(),
    } as const;

    const result = await billing.startCheckout(ctx, { plan: 'pro' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.url).toContain('https://billing.fake.stripe.test/checkout/');
      expect(result.value.sessionId).toMatch(/^cs_fake_/);
    }
    expect(gateway.checkoutCalls).toHaveLength(1);
    expect(gateway.checkoutCalls[0]?.input.workspaceId).toBe('ws_1');
    expect(gateway.checkoutCalls[0]?.input.stripeCustomerId).toBe('cus_1');
  });

  it('startCheckout fails with INTERNAL when no gateway is configured', async () => {
    const { store } = makeStore();
    const billing = createBilling({ store, prices: PRICES });
    const ctx = {
      workspaceId: 'ws_1',
      actor: { type: 'user', id: 'u_1' },
      requestId: 'req_1',
      now: () => new Date(),
    } as const;
    const result = await billing.startCheckout(ctx, { plan: 'pro' });
    expect(!result.ok && result.error.code).toBe('INTERNAL');
  });

  it('startCheckout fails when the plan price env id is missing', async () => {
    const { store } = makeStore();
    const billing = createBilling({
      store,
      stripe: createFakeStripeGateway(),
      prices: { business: 'price_business' }, // pro missing
    });
    const ctx = {
      workspaceId: 'ws_1',
      actor: { type: 'user', id: 'u_1' },
      requestId: 'req_1',
      now: () => new Date(),
    } as const;
    const result = await billing.startCheckout(ctx, { plan: 'pro' });
    expect(!result.ok && result.error.code).toBe('INTERNAL');
    expect(!result.ok && result.error.message).toMatch(/not configured/i);
  });

  it('createPortalSession requires an existing Stripe customer', async () => {
    const { store } = makeStore({
      ws_free: { workspaceId: 'ws_free', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = makeBilling(store);
    const ctx = {
      workspaceId: 'ws_free',
      actor: { type: 'user', id: 'u_1' },
      requestId: 'req_1',
      now: () => new Date(),
    } as const;
    const result = await billing.createPortalSession(ctx);
    expect(!result.ok && result.error.code).toBe('VALIDATION');
  });

  it('createPortalSession returns the portal URL', async () => {
    const { store } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'pro', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' },
    });
    const gateway = createFakeStripeGateway();
    const billing = makeBilling(store, gateway);
    const ctx = {
      workspaceId: 'ws_1',
      actor: { type: 'user', id: 'u_1' },
      requestId: 'req_1',
      now: () => new Date(),
    } as const;
    const result = await billing.createPortalSession(ctx);
    expect(result.ok && result.value.url).toContain('/portal/');
    expect(gateway.portalCalls).toHaveLength(1);
    expect(gateway.portalCalls[0]?.input.stripeCustomerId).toBe('cus_1');
  });
});

describe('seats (spec §13: 1/3/10)', () => {
  it('reports usage against the plan limit', async () => {
    const { store } = makeStore({
      ws_1: { workspaceId: 'ws_1', plan: 'pro', stripeCustomerId: null, stripeSubscriptionId: null } as WorkspaceBillingRow & { members: number },
    });
    (store.rows.get('ws_1') as WorkspaceBillingRow & { members: number }).members = 2;
    const billing = makeBilling(store);
    await expect(billing.seatUsage('ws_1')).resolves.toEqual({ used: 2, limit: 3 });
  });

  it('canInviteMember ok when below the limit', async () => {
    const { store } = makeStore();
    store.rows.set('ws_1', {
      workspaceId: 'ws_1',
      plan: 'business',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const billing = makeBilling(store);
    const result = await billing.canInviteMember('ws_1');
    expect(result.ok && result.value.limit).toBe(10);
  });

  it('canInviteMember returns PLAN_LIMIT with capability + requiredPlan at the cap', async () => {
    const { store } = makeStore();
    store.rows.set('ws_1', {
      workspaceId: 'ws_1',
      plan: 'free',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const billing = makeBilling(store);
    // free plan: 1 seat, 1 member used → inviting needs 2 seats → pro
    const result = await billing.canInviteMember('ws_1');
    expect(!result.ok).toBe(true);
    if (!result.ok) {
      const error = result.error as AppError;
      expect(error.code).toBe('PLAN_LIMIT');
      expect(error.details).toEqual([
        { path: 'capability', message: 'seats' },
        { path: 'requiredPlan', message: 'pro' },
        { path: 'need', message: '2' },
      ]);
    }
  });

  it('business at 10/10 has no upgrade path (requiredPlan null)', async () => {
    const { store } = makeStore();
    const seeded: WorkspaceBillingRow & { members: number } = {
      workspaceId: 'ws_1',
      plan: 'business',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      members: 10,
    };
    store.rows.set('ws_1', seeded);
    const billing = makeBilling(store);
    const result = await billing.canInviteMember('ws_1');
    if (!result.ok) {
      expect(result.error.details).toEqual([
        { path: 'capability', message: 'seats' },
        { path: 'need', message: '11' },
      ]);
    } else {
      expect.unreachable('expected PLAN_LIMIT');
    }
  });
});
