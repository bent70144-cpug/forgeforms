import {
  isUpgrade,
  type PaidPlan,
  type Plan,
  type PlanCatalogEntry,
} from '@formforge/core/billing';

// apps/web/app/(app)/settings/billing/PlanCard.tsx
// One plan card. Upgrade CTAs live HERE ONLY (settings surface) — spec §13
// forbids upgrade prompts inside editing surfaces. All Stripe side effects
// go through the server actions (injected gateway behind the billing service).

export type PlanCardProps = {
  entry: PlanCatalogEntry;
  currentPlan: Plan;
  /** Stripe configured AND a price id exists for this plan. */
  checkoutAvailable: boolean;
  onCheckout: (formData: FormData) => Promise<void>;
  onPortal: () => Promise<void>;
};

/** Paid plans are exactly the catalog entries with a Stripe price env key. */
function paidPlanOf(entry: PlanCatalogEntry): PaidPlan {
  return entry.stripePriceEnvKey === 'STRIPE_PRICE_BUSINESS' ? 'business' : 'pro';
}

export default function PlanCard({
  entry,
  currentPlan,
  checkoutAvailable,
  onCheckout,
  onPortal,
}: PlanCardProps) {
  const isCurrent = entry.id === currentPlan;
  const upgrade = isUpgrade(currentPlan, entry.id);
  const needsPortal = !isCurrent && !upgrade; // downgrade / switch → portal
  const disabled = needsPortal ? false : !checkoutAvailable && !isCurrent;

  return (
    <div
      className={`flex flex-col rounded-xl border p-6 ${
        isCurrent ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{entry.name}</h3>
        {isCurrent ? (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
            Current plan
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-slate-500">{entry.tagline}</p>
      <p className="mt-4 text-2xl font-bold">
        ${entry.priceMonthlyUsd}
        <span className="text-sm font-normal text-slate-500">/mo</span>
      </p>

      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-slate-600">
        {entry.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <span aria-hidden className="text-indigo-500">
              ✓
            </span>
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {isCurrent ? (
          <button
            type="button"
            disabled
            className="w-full cursor-default rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400"
          >
            Current plan
          </button>
        ) : upgrade && entry.stripePriceEnvKey ? (
          <form action={onCheckout}>
            <input type="hidden" name="plan" value={paidPlanOf(entry)} />
            <button
              type="submit"
              disabled={disabled}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              Upgrade to {entry.name}
            </button>
          </form>
        ) : (
          <form action={onPortal}>
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {entry.id === 'free' ? 'Cancel via billing portal' : 'Switch via billing portal'}
            </button>
          </form>
        )}
        {disabled ? (
          <p className="mt-2 text-xs text-slate-400">
            Stripe is not configured for this plan (missing {entry.stripePriceEnvKey}).
          </p>
        ) : null}
        {needsPortal ? (
          <p className="mt-2 text-xs text-slate-400">Managed in the Stripe billing portal.</p>
        ) : null}
      </div>
    </div>
  );
}
