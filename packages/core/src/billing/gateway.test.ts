// tests: StripeGateway adapters — fake (recording) and zero-dep fetch impl
// (network mocked; no Stripe SDK, no keys).
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../bridge';
import { createFakeStripeGateway } from './stripe/fake-gateway';
import { createStripeGateway } from './stripe/fetch-gateway';

describe('createFakeStripeGateway', () => {
  it('records checkout + portal calls and returns deterministic fake URLs', async () => {
    const gateway = createFakeStripeGateway();
    const checkout = await gateway.createCheckoutSession({
      workspaceId: 'ws_1',
      plan: 'pro',
      stripeCustomerId: null,
      successUrl: 'https://app.test/settings/billing',
      cancelUrl: 'https://app.test/settings/billing',
    });
    expect(checkout.ok && checkout.value.url.startsWith('https://billing.fake.stripe.test/checkout/')).toBe(true);
    expect(checkout.ok && checkout.value.plan).toBe('pro');

    const portal = await gateway.createPortalSession({
      stripeCustomerId: 'cus_1',
      returnUrl: 'https://app.test/settings/billing',
    });
    expect(portal.ok && portal.value.url.startsWith('https://billing.fake.stripe.test/portal/')).toBe(true);

    expect(gateway.checkoutCalls).toHaveLength(1);
    expect(gateway.portalCalls).toHaveLength(1);
    expect(gateway.calls).toHaveLength(2);
  });

  it('failNext injects exactly one failure', async () => {
    const gateway = createFakeStripeGateway({
      failNext: new AppError('INTERNAL', 'stripe down'),
    });
    const first = await gateway.createPortalSession({
      stripeCustomerId: 'cus_1',
      returnUrl: 'x',
    });
    expect(!first.ok && first.error.message).toBe('stripe down');
    // reset happened → next call succeeds
    const second = await gateway.createPortalSession({
      stripeCustomerId: 'cus_1',
      returnUrl: 'x',
    });
    expect(second.ok).toBe(true);
  });
});

describe('createStripeGateway (zero-dep fetch adapter)', () => {
  const config = {
    apiKey: 'sk_test_123',
    prices: { pro: 'price_pro', business: 'price_business' },
    apiBaseUrl: 'https://api.stripe.test/v1',
  } as const;

  const OK_CHECKOUT = { id: 'cs_live_1', url: 'https://checkout.stripe.com/c/pay/cs_live_1' };
  const OK_PORTAL = { id: 'bps_1', url: 'https://billing.stripe.com/p/session/bps_1' };

  function fetchOk(body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  }

  it('POSTs form-encoded checkout session params with bearer auth', async () => {
    const fetchImpl = fetchOk(OK_CHECKOUT);
    const gateway = createStripeGateway({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await gateway.createCheckoutSession({
      workspaceId: 'ws_1',
      plan: 'business',
      stripeCustomerId: 'cus_1',
      successUrl: 'https://app.test/settings/billing?checkout=success',
      cancelUrl: 'https://app.test/settings/billing?checkout=canceled',
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.test/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk_test_123');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(init.body as string);
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('line_items[0][price]')).toBe('price_business');
    expect(params.get('line_items[0][quantity]')).toBe('1');
    expect(params.get('client_reference_id')).toBe('ws_1');
    expect(params.get('metadata[workspaceId]')).toBe('ws_1');
    expect(params.get('metadata[plan]')).toBe('business');
    expect(params.get('subscription_data[metadata][workspaceId]')).toBe('ws_1');
    expect(params.get('customer')).toBe('cus_1');
    expect(params.get('success_url')).toContain('checkout=success');
  });

  it('uses customer_email when no stripe customer exists yet', async () => {
    const fetchImpl = fetchOk(OK_CHECKOUT);
    const gateway = createStripeGateway({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
    await gateway.createCheckoutSession({
      workspaceId: 'ws_1',
      plan: 'pro',
      stripeCustomerId: null,
      customerEmail: 'owner@example.com',
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.get('customer')).toBeNull();
    expect(params.get('customer_email')).toBe('owner@example.com');
  });

  it('maps Stripe API errors to an INTERNAL AppError', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'No such price', type: 'invalid_request_error' } }),
          { status: 400 },
        ),
    );
    const gateway = createStripeGateway({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await gateway.createCheckoutSession({
      workspaceId: 'ws_1',
      plan: 'pro',
      stripeCustomerId: null,
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    });
    expect(!result.ok && result.error.code).toBe('INTERNAL');
    expect(!result.ok && result.error.message).toBe('No such price');
  });

  it('maps network failures to an INTERNAL AppError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const gateway = createStripeGateway({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await gateway.createPortalSession({
      stripeCustomerId: 'cus_1',
      returnUrl: 'https://app.test/settings/billing',
    });
    expect(!result.ok && result.error.code).toBe('INTERNAL');
  });

  it('fails fast when the plan price id is missing from config', async () => {
    const fetchImpl = fetchOk(OK_CHECKOUT);
    const gateway = createStripeGateway({
      apiKey: 'sk_test_123',
      prices: { pro: 'price_pro', business: '' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await gateway.createCheckoutSession({
      workspaceId: 'ws_1',
      plan: 'business',
      stripeCustomerId: null,
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    });
    expect(!result.ok && result.error.code).toBe('INTERNAL');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates portal sessions against /billing_portal/sessions', async () => {
    const fetchImpl = fetchOk(OK_PORTAL);
    const gateway = createStripeGateway({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await gateway.createPortalSession({
      stripeCustomerId: 'cus_1',
      returnUrl: 'https://app.test/settings/billing?portal=returned',
    });
    expect(result.ok && result.value.url).toContain('/p/session/');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.test/v1/billing_portal/sessions');
    const params = new URLSearchParams(init.body as string);
    expect(params.get('customer')).toBe('cus_1');
    expect(params.get('return_url')).toContain('portal=returned');
  });
});
