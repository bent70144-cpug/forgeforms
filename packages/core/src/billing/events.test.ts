// tests: Stripe event parsing + classification per handled type.
import { describe, expect, it } from 'vitest';
import {
  buildStripeEvent,
  parseStripeEvent,
  planFromMetadata,
  workspaceIdFromMetadata,
} from './stripe/events';
import { classifyStripeEvent, priceToPlanMap } from './lifecycle';

const PRICE_MAP = priceToPlanMap({ pro: 'price_pro', business: 'price_business' });

describe('parseStripeEvent', () => {
  it('parses the Stripe event envelope', () => {
    const raw = JSON.stringify(
      buildStripeEvent('checkout.session.completed', { id: 'cs_1', mode: 'subscription' }),
    );
    const result = parseStripeEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('checkout.session.completed');
      expect(result.value.data.object['id']).toBe('cs_1');
    }
  });

  it('rejects non-JSON bodies', () => {
    const result = parseStripeEvent('not json {{');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });

  it('rejects bodies missing the envelope fields', () => {
    const result = parseStripeEvent(JSON.stringify({ type: 'checkout.session.completed' }));
    expect(result.ok).toBe(false);
  });
});

describe('buildStripeEvent (fixture)', () => {
  it('defaults id/created deterministically', () => {
    const event = buildStripeEvent('invoice.payment_failed', { id: 'in_1' });
    expect(event.id).toBe('evt_test_invoice_payment_failed');
    expect(event.created).toBe(1_700_000_000);
  });
});

describe('classifyStripeEvent — checkout.session.completed', () => {
  it('maps metadata workspaceId + plan', () => {
    const event = buildStripeEvent('checkout.session.completed', {
      id: 'cs_1',
      mode: 'subscription',
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: { workspaceId: 'ws_1', plan: 'pro' },
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'checkout.completed') {
      expect(result.value.workspaceId).toBe('ws_1');
      expect(result.value.customerId).toBe('cus_1');
      expect(result.value.subscriptionId).toBe('sub_1');
      expect(result.value.plan).toBe('pro');
    } else {
      expect.unreachable('should classify as checkout.completed');
    }
  });

  it('falls back to client_reference_id for workspace attribution', () => {
    const event = buildStripeEvent('checkout.session.completed', {
      id: 'cs_2',
      mode: 'subscription',
      subscription: 'sub_2',
      client_reference_id: 'ws_from_cri',
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    expect(result.ok && result.value.kind === 'checkout.completed').toBe(true);
    if (result.ok && result.value.kind === 'checkout.completed') {
      expect(result.value.workspaceId).toBe('ws_from_cri');
      // no metadata plan → plan resolved later from subscription price
      expect(result.value.plan).toBeNull();
    }
  });

  it('non-subscription checkouts carry no plan', () => {
    const event = buildStripeEvent('checkout.session.completed', {
      id: 'cs_3',
      mode: 'payment',
      metadata: { workspaceId: 'ws_1', plan: 'business' },
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    if (result.ok && result.value.kind === 'checkout.completed') {
      expect(result.value.plan).toBeNull();
      expect(result.value.subscriptionId).toBeNull();
    } else {
      expect.unreachable();
    }
  });
});

describe('classifyStripeEvent — customer.subscription.updated', () => {
  it('maps the price id through the price map', () => {
    const event = buildStripeEvent('customer.subscription.updated', {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { workspaceId: 'ws_1' },
      items: { data: [{ price: { id: 'price_business' } }] },
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    if (result.ok && result.value.kind === 'subscription.updated') {
      expect(result.value.plan).toBe('business');
      expect(result.value.status).toBe('active');
    } else {
      expect.unreachable();
    }
  });

  it('unknown price id falls back to subscription metadata plan', () => {
    const event = buildStripeEvent('customer.subscription.updated', {
      id: 'sub_1',
      status: 'active',
      metadata: { workspaceId: 'ws_1', plan: 'pro' },
      items: { data: [{ price: { id: 'price_rotated_away' } }] },
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    if (result.ok && result.value.kind === 'subscription.updated') {
      expect(result.value.plan).toBe('pro');
    } else {
      expect.unreachable();
    }
  });

  it('unknown status strings are normalized conservatively (grace)', () => {
    const event = buildStripeEvent('customer.subscription.updated', {
      id: 'sub_1',
      status: 'mysterious_future_status',
      items: { data: [{ price: { id: 'price_pro' } }] },
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    if (result.ok && result.value.kind === 'subscription.updated') {
      expect(result.value.status).toBe('incomplete');
    } else {
      expect.unreachable();
    }
  });
});

describe('classifyStripeEvent — deletion, dunning, unhandled', () => {
  it('subscription.deleted keeps workspace + customer, flags the id', () => {
    const event = buildStripeEvent('customer.subscription.deleted', {
      id: 'sub_9',
      customer: 'cus_1',
      status: 'canceled',
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    if (result.ok && result.value.kind === 'subscription.deleted') {
      expect(result.value.subscriptionId).toBe('sub_9');
      expect(result.value.customerId).toBe('cus_1');
    } else {
      expect.unreachable();
    }
  });

  it('invoice.payment_failed carries the attempt counter', () => {
    const event = buildStripeEvent('invoice.payment_failed', {
      id: 'in_1',
      customer: 'cus_1',
      subscription: 'sub_1',
      attempt_count: 2,
    });
    const result = classifyStripeEvent(event, PRICE_MAP);
    if (result.ok && result.value.kind === 'invoice.payment_failed') {
      expect(result.value.attemptCount).toBe(2);
    } else {
      expect.unreachable();
    }
  });

  it('unknown event types classify as unhandled (ack, do not process)', () => {
    const event = buildStripeEvent('customer.discount.created', { id: 'di_1' });
    const result = classifyStripeEvent(event, PRICE_MAP);
    if (result.ok) {
      expect(result.value.kind).toBe('unhandled');
    } else {
      expect.unreachable();
    }
  });

  it('malformed handled payloads are a VALIDATION error', () => {
    const event = buildStripeEvent('customer.subscription.updated', { nope: true });
    const result = classifyStripeEvent(event, PRICE_MAP);
    expect(result.ok).toBe(false);
  });
});

describe('metadata helpers', () => {
  it('workspaceIdFromMetadata ignores non-strings', () => {
    expect(workspaceIdFromMetadata({ workspaceId: 'ws_1' })).toBe('ws_1');
    expect(workspaceIdFromMetadata({ workspaceId: 42 })).toBeNull();
    expect(workspaceIdFromMetadata(undefined)).toBeNull();
  });

  it('planFromMetadata only accepts paid plans', () => {
    expect(planFromMetadata({ plan: 'business' })).toBe('business');
    expect(planFromMetadata({ plan: 'free' })).toBeNull();
    expect(planFromMetadata({ plan: 'enterprise' })).toBeNull();
  });
});
