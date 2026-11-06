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

/** Inline check used for every feature bullet (stroke = currentColor). */
function FeatureCheck() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-primary)]"
    >
      <path
        d="m4.5 10.5 3.5 3.5 7.5-8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
      className={`flex flex-col rounded-[var(--ff-radius)] border bg-[var(--ff-card)] p-6 transition-shadow hover:shadow-md ${
        isCurrent ? 'border-transparent ring-2 ring-[var(--ff-primary)]' : 'border-[var(--ff-border)]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{entry.name}</h3>
        {isCurrent ? <span className="ff-badge ff-badge--accent">Current plan</span> : null}
      </div>
      <p className="mt-1 text-sm text-[var(--ff-muted)]">{entry.tagline}</p>
      <p className="mt-4 text-2xl font-bold tabular-nums">
        ${entry.priceMonthlyUsd}
        <span className="text-sm font-normal text-[var(--ff-muted)]">/mo</span>
      </p>

      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-[var(--ff-muted)]">
        {entry.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <FeatureCheck />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {isCurrent ? (
          <button
            type="button"
            disabled
            className="h-10 w-full cursor-not-allowed rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-4 text-sm font-medium text-[var(--ff-muted)]"
          >
            Current plan
          </button>
        ) : upgrade && entry.stripePriceEnvKey ? (
          <form action={onCheckout}>
            <input type="hidden" name="plan" value={paidPlanOf(entry)} />
            <button
              type="submit"
              disabled={disabled}
              className="h-10 w-full cursor-pointer rounded-[calc(var(--ff-radius)*0.66)] border border-transparent bg-[var(--ff-primary)] px-4 text-sm font-medium text-[var(--ff-primary-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
            >
              Upgrade to {entry.name}
            </button>
          </form>
        ) : (
          <form action={onPortal}>
            <button
              type="submit"
              className="h-10 w-full cursor-pointer rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-4 text-sm font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))]"
            >
              {entry.id === 'free' ? 'Cancel via billing portal' : 'Switch via billing portal'}
            </button>
          </form>
        )}
        {disabled ? (
          <p className="mt-2 text-xs text-[var(--ff-muted)]">
            Stripe is not configured for this plan (missing {entry.stripePriceEnvKey}).
          </p>
        ) : null}
        {needsPortal ? (
          <p className="mt-2 text-xs text-[var(--ff-muted)]">Managed in the Stripe billing portal.</p>
        ) : null}
      </div>
    </div>
  );
}
