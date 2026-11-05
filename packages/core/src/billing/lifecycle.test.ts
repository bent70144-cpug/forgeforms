// tests: subscription lifecycle state machine from webhook events
// (upgrade, downgrade, dunning grace, cancel → re-lock).
import { describe, expect, it } from 'vitest';
import {
  classifyStripeEvent,
  INITIAL_BILLING_STATE,
  priceToPlanMap,
  reduceBillingEvent,
  type BillingState,
} from './lifecycle';
import { buildStripeEvent } from './stripe/events';

const PRICE_MAP = priceToPlanMap({ pro: 'price_pro', business: 'price_business' });

function checkoutCompleted(workspaceId = 'ws_1', plan = 'pro') {
  return buildStripeEvent('checkout.session.completed', {
    id: 'cs_1',
    mode: 'subscription',
    customer: 'cus_1',
    subscription: 'sub_1',
    metadata: { workspaceId, plan },
  });
}

function subscriptionUpdated(
  status: string,
  priceId = 'price_pro',
  extras: Record<string, unknown> = {},
) {
  return buildStripeEvent('customer.subscription.updated', {
    id: 'sub_1',
    customer: 'cus_1',
    status,
    items: { data: [{ price: { id: priceId } }] },
    metadata: { workspaceId: 'ws_1' },
    ...extras,
  });
}

function subscriptionDeleted() {
  return buildStripeEvent('customer.subscription.deleted', {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'canceled',
  });
}

function paymentFailed(attemptCount = 1) {
  return buildStripeEvent('invoice.payment_failed', {
    id: 'in_1',
    customer: 'cus_1',
    subscription: 'sub_1',
    attempt_count: attemptCount,
  });
}

function apply(state: BillingState, event: ReturnType<typeof buildStripeEvent>): BillingState {
  const classified = classifyStripeEvent(event, PRICE_MAP);
  expect(classified.ok, 'fixture events must classify').toBe(true);
  if (!classified.ok) throw new Error('fixture failed to classify');
  return reduceBillingEvent(state, classified.value);
}

describe('subscription lifecycle state machine', () => {
  it('checkout.session.completed adopts the plan and ids', () => {
    const state = apply(INITIAL_BILLING_STATE, checkoutCompleted());
    expect(state).toEqual({
      plan: 'pro',
      subscriptionStatus: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('full lifecycle: checkout → upgrade → dunning grace → cancel → re-lock to free', () => {
    let state = INITIAL_BILLING_STATE;

    state = apply(state, checkoutCompleted('ws_1', 'pro'));
    expect(state.plan).toBe('pro');

    // customer switches price pro → business inside the portal
    state = apply(state, subscriptionUpdated('active', 'price_business'));
    expect(state.plan).toBe('business');
    expect(state.subscriptionStatus).toBe('active');

    // dunning: payment fails, subscription flips past_due — plan KEPT (grace)
    state = apply(state, paymentFailed(1));
    expect(state.plan).toBe('business');
    expect(state.subscriptionStatus).toBe('past_due');

    state = apply(state, subscriptionUpdated('past_due', 'price_business'));
    expect(state.plan).toBe('business');

    state = apply(state, subscriptionUpdated('unpaid', 'price_business'));
    expect(state.plan).toBe('business');

    // Stripe gives up → subscription deleted → re-lock
    state = apply(state, subscriptionDeleted());
    expect(state.plan).toBe('free');
    expect(state.subscriptionStatus).toBe('canceled');
    expect(state.stripeSubscriptionId).toBeNull();
    // customer id survives so a later checkout reuses it
    expect(state.stripeCustomerId).toBe('cus_1');
  });

  it('cancel_at_period_end=true does NOT downgrade before deletion', () => {
    let state = apply(INITIAL_BILLING_STATE, checkoutCompleted());
    state = apply(state, subscriptionUpdated('active', 'price_pro', { cancel_at_period_end: true }));
    expect(state.plan).toBe('pro');
    expect(state.subscriptionStatus).toBe('active');
  });

  it('terminal statuses on subscription.updated re-lock to free', () => {
    let state = apply(INITIAL_BILLING_STATE, checkoutCompleted());
    state = apply(state, subscriptionUpdated('canceled'));
    expect(state.plan).toBe('free');
    state = apply(INITIAL_BILLING_STATE, checkoutCompleted());
    state = apply(state, subscriptionUpdated('incomplete_expired'));
    expect(state.plan).toBe('free');
  });

  it('trialing counts as active and adopts the plan', () => {
    let state = apply(INITIAL_BILLING_STATE, checkoutCompleted('ws_1', 'business'));
    state = apply(state, subscriptionUpdated('trialing', 'price_business'));
    expect(state.plan).toBe('business');
    expect(state.subscriptionStatus).toBe('trialing');
  });

  it('payment_failed never downgrades by itself (Stripe drives via subscription events)', () => {
    let state = apply(INITIAL_BILLING_STATE, checkoutCompleted());
    state = apply(state, paymentFailed(4));
    expect(state.plan).toBe('pro');
    expect(state.subscriptionStatus).toBe('past_due');
  });

  it('payment_failed on a canceled subscription stays canceled', () => {
    let state = apply(INITIAL_BILLING_STATE, checkoutCompleted());
    state = apply(state, subscriptionDeleted());
    state = apply(state, paymentFailed(1));
    expect(state.subscriptionStatus).toBe('canceled');
    expect(state.plan).toBe('free');
  });

  it('checkout without a subscription id is a no-op (payment-mode checkout)', () => {
    const event = buildStripeEvent('checkout.session.completed', {
      id: 'cs_2',
      mode: 'payment',
      metadata: { workspaceId: 'ws_1', plan: 'business' },
    });
    const state = apply(INITIAL_BILLING_STATE, event);
    expect(state).toEqual(INITIAL_BILLING_STATE);
  });

  it('unhandled events leave state untouched', () => {
    const event = buildStripeEvent('invoice.paid', { id: 'in_2' });
    const state = apply(INITIAL_BILLING_STATE, event);
    expect(state).toBe(INITIAL_BILLING_STATE);
  });

  it('unknown workspace plan values in metadata do not corrupt state', () => {
    const event = buildStripeEvent('checkout.session.completed', {
      id: 'cs_3',
      mode: 'subscription',
      subscription: 'sub_3',
      metadata: { workspaceId: 'ws_1', plan: 'enterprise' },
    });
    const state = apply(INITIAL_BILLING_STATE, event);
    expect(state.plan).toBe('free'); // metadata plan rejected → keeps current
    expect(state.stripeSubscriptionId).toBe('sub_3');
  });
});

describe('priceToPlanMap', () => {
  it('inverts the env price map', () => {
    expect(PRICE_MAP).toEqual({ price_pro: 'pro', price_business: 'business' });
  });
  it('ignores missing price ids', () => {
    expect(priceToPlanMap({ pro: undefined })).toEqual({});
  });
});
