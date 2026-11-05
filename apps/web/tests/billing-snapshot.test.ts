// tests: settings→billing snapshot loader — storage-ready path and the
// graceful Free-plan degradation while T02's billing tables are missing.

import { describe, expect, it } from 'vitest';
import {
  buildStripeEvent,
  createBilling,
  createFakeStripeGateway,
  type BillingStore,
  type WorkspaceBillingRow,
} from '@formforge/core/billing';
import {
  loadBillingSnapshot,
  resolveWorkspaceId,
} from '../app/(app)/settings/billing/_lib/billing-server';

function makeStore(seed: Record<string, WorkspaceBillingRow> = {}): BillingStore {
  const rows = new Map(Object.entries(seed));
  const processed = new Set<string>();
  return {
    async getWorkspaceBilling(workspaceId) {
      return rows.get(workspaceId) ?? null;
    },
    async findWorkspaceIdByStripeCustomer() {
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
      processed.add(input.eventId);
    },
    async countMembers() {
      return 2;
    },
    async getMonthlySubmissions() {
      return 0;
    },
  };
}

function billingFor(store: BillingStore) {
  return createBilling({
    store,
    stripe: createFakeStripeGateway(),
    prices: { pro: 'price_pro' },
    webhookSecret: 'whsec_test',
    now: () => new Date(1_700_000_000_000),
  });
}

describe('loadBillingSnapshot', () => {
  it('renders the live plan, seats and entitlements when storage is ready', async () => {
    const store = makeStore({
      '00000000-0000-7000-8000-000000000000': {
        workspaceId: '00000000-0000-7000-8000-000000000000',
        plan: 'pro',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    });
    const snapshot = await loadBillingSnapshot(billingFor(store));
    expect(snapshot.storageReady).toBe(true);
    expect(snapshot.plan).toBe('pro');
    expect(snapshot.seats).toEqual({ used: 2, limit: 3 });
    expect(snapshot.entitlements.removeBranding).toBe(true);
    expect(snapshot.stripe.configured).toBe(false); // no STRIPE_SECRET_KEY in test env
  });

  it('degrades to the Free view (storageReady: false) when the store throws', async () => {
    const store: BillingStore = {
      ...makeStore(),
      async getWorkspaceBilling() {
        throw new Error('relation "workspaces" does not exist');
      },
      async countMembers() {
        throw new Error('relation "memberships" does not exist');
      },
    };
    const snapshot = await loadBillingSnapshot(billingFor(store));
    expect(snapshot.storageReady).toBe(false);
    expect(snapshot.plan).toBe('free');
    expect(snapshot.seats).toEqual({ used: 0, limit: 1 });
    expect(snapshot.entitlements.removeBranding).toBe(false);
  });

  it('applyStripeEvent→snapshot round-trip: upgrade unlocks within the cache TTL', async () => {
    const ws = '00000000-0000-7000-8000-000000000000';
    const store = makeStore({
      [ws]: { workspaceId: ws, plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null },
    });
    const billing = billingFor(store);
    const before = await loadBillingSnapshot(billing);
    expect(before.entitlements.analytics).toBe(false);

    await billing.applyStripeEvent(
      buildStripeEvent(
        'checkout.session.completed',
        {
          id: 'cs_1',
          mode: 'subscription',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { workspaceId: ws, plan: 'pro' },
        },
        { id: 'evt_rt_1' },
      ),
    );

    const after = await loadBillingSnapshot(billing); // cache invalidated on plan change
    expect(after.plan).toBe('pro');
    expect(after.entitlements.analytics).toBe(true);
  });
});

describe('resolveWorkspaceId', () => {
  it('uses FORMFORGE_DEV_WORKSPACE_ID when set (T03 will replace this)', () => {
    expect(resolveWorkspaceId({ FORMFORGE_DEV_WORKSPACE_ID: 'ws_dev' } as unknown as NodeJS.ProcessEnv)).toBe(
      'ws_dev',
    );
    expect(resolveWorkspaceId({} as unknown as NodeJS.ProcessEnv)).toBe(
      '00000000-0000-7000-8000-000000000000',
    );
  });
});
