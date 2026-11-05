// apps/web/app/api/webhooks/stripe/_lib/billing-server.ts
// Env wiring for the billing service (spec §5 env names, §3 injected ports).
// The ONLY place in web that knows how @formforge/core's billing service is
// assembled from the real adapters:
//   store   ← @formforge/db billing repository (raw SQL until T02's schema)
//   stripe  ← zero-dependency fetch gateway when STRIPE_SECRET_KEY is set
// Tests never import this file — they build createBilling() with fakes.

import {
  createBilling,
  createStripeGateway,
  type Billing,
  type PaidPlan,
  type PlanPrices,
} from '@formforge/core/billing';
import {
  createBillingDb,
  createBillingRepository,
} from '@formforge/db/repositories/billing';

export type StripeEnvStatus = {
  /** Gateway exists (STRIPE_SECRET_KEY set). Checkout/portal possible. */
  configured: boolean;
  /** Plans that have a price id (STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS). */
  priceReady: Partial<Record<PaidPlan, boolean>>;
};

function envPrices(env: NodeJS.ProcessEnv): PlanPrices {
  const prices: PlanPrices = {};
  if (env.STRIPE_PRICE_PRO) prices.pro = env.STRIPE_PRICE_PRO;
  if (env.STRIPE_PRICE_BUSINESS) prices.business = env.STRIPE_PRICE_BUSINESS;
  return prices;
}

/** Build a billing service from process env. Public for tests/bootstrap;
 * prefer `getBilling()` (memoized) in request paths. */
export function createBillingFromEnv(env: NodeJS.ProcessEnv = process.env): Billing {
  const prices = envPrices(env);
  return createBilling({
    store: createBillingRepository(createBillingDb(env.DATABASE_URL ?? '')),
    stripe: env.STRIPE_SECRET_KEY
      ? createStripeGateway({ apiKey: env.STRIPE_SECRET_KEY, prices })
      : undefined,
    prices,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    appUrl: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  });
}

/** Which Stripe features are usable right now — the settings UI reads this
 * to disable upgrade buttons instead of shipping requests that must fail. */
export function stripeEnvStatus(env: NodeJS.ProcessEnv = process.env): StripeEnvStatus {
  return {
    configured: Boolean(env.STRIPE_SECRET_KEY),
    priceReady: {
      pro: Boolean(env.STRIPE_PRICE_PRO),
      business: Boolean(env.STRIPE_PRICE_BUSINESS),
    },
  };
}

const globalForBilling = globalThis as typeof globalThis & {
  __formforgeBilling?: Billing;
};

/** Process-wide billing service (one cache, one pool). */
export function getBilling(): Billing {
  globalForBilling.__formforgeBilling ??= createBillingFromEnv();
  return globalForBilling.__formforgeBilling;
}
