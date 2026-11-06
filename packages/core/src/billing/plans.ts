// packages/core/src/billing/plans.ts
// Plan catalog (spec §6 `workspaces.plan`, §13; issue #23 body).

export type PaidPlan = 'pro' | 'business';
export type Plan = 'free' | PaidPlan;

/** Plan ids ordered by rank — index IS the upgrade order. */
export const PLANS = ['free', 'pro', 'business'] as const satisfies readonly Plan[];

export type StripePriceEnvKey = 'STRIPE_PRICE_PRO' | 'STRIPE_PRICE_BUSINESS';

export type PlanCatalogEntry = {
  id: Plan;
  name: string;
  priceMonthlyUsd: number;
  tagline: string;
  /** Env var holding the Stripe price id for subscription checkouts.
   * Null for the free plan (no checkout). */
  stripePriceEnvKey: StripePriceEnvKey | null;
  features: string[];
};

// SPEC-NOTE: spec does not pin display prices; the Stripe price ids in env
// (STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS, spec §5) are the billing source
// of truth. The USD numbers here are display-only for settings/pricing cards.
export const PLAN_CATALOG: Record<Plan, PlanCatalogEntry> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthlyUsd: 0,
    tagline: 'Everything you need to ship your first form.',
    stripePriceEnvKey: null,
    features: [
      'Unlimited documents',
      'Unlimited submissions (fair use)',
      '10 MB file uploads',
      'Webhooks',
      '1 seat',
      'FormForge branding',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthlyUsd: 19,
    tagline: 'For freelancers and small teams.',
    stripePriceEnvKey: 'STRIPE_PRICE_PRO',
    features: [
      'Remove FormForge branding',
      '1 custom domain',
      '3 seats',
      'Advanced analytics (drop-off)',
      'Partial submissions',
      'API access',
      'AI drafts',
      '10 MB file uploads',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    priceMonthlyUsd: 49,
    tagline: 'For agencies running client work at scale.',
    stripePriceEnvKey: 'STRIPE_PRICE_BUSINESS',
    features: [
      'Remove FormForge branding',
      '5 custom domains',
      '10 seats',
      'Advanced analytics (drop-off)',
      'Partial submissions',
      'API access',
      'AI drafts',
      '50 MB file uploads',
    ],
  },
};

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

export function isPaidPlan(value: string): value is PaidPlan {
  return value === 'pro' || value === 'business';
}

export function planRank(plan: Plan): number {
  return PLANS.indexOf(plan);
}

export function isUpgrade(from: Plan, to: Plan): boolean {
  return planRank(to) > planRank(from);
}

export type PlanPrices = Partial<Record<PaidPlan, string>>;

/** Resolve the Stripe price id for a paid plan. Returns null when the env
 * var is missing so callers can fail with a typed error. */
export function stripePriceFor(plan: PaidPlan, prices: PlanPrices): string | null {
  return prices[plan] ?? null;
}
