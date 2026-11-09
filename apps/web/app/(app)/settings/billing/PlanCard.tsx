import { Icon } from '@/components/ui/icons';
import { BTN_PRIMARY, BTN_SECONDARY } from '@/lib/ui';
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
//
// Presentation notes (aurora glass): the card is NOT interactive, so there is
// no hover lift; the current plan is signalled ONCE per channel — a violet
// ring + soft glow + gradient spine on the card and a single violet badge in
// the header row — and feature checks stay muted so the violet reads as the
// only energy on the card. Explanatory texts live in the page-level footnote
// instead of repeating per card.

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
      className="ff-panel relative flex h-full flex-col p-6"
      style={
        isCurrent
          ? {
              borderColor: 'var(--ff-primary)',
              borderWidth: '1.5px',
              background: 'color-mix(in srgb, var(--ff-primary) 6%, var(--ff-card))',
              boxShadow: 'var(--ff-glow-soft), var(--ff-shadow-sm)',
            }
          : undefined
      }
    >
      {isCurrent ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[2px] overflow-hidden rounded-t-[var(--ff-radius)]"
          style={{ background: 'var(--ff-grad)' }}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{entry.name}</h3>
        {isCurrent ? (
          <span
            className="ff-badge"
            style={{
              borderColor: 'color-mix(in srgb, var(--ff-primary) 40%, transparent)',
              background: 'color-mix(in srgb, var(--ff-primary) 16%, transparent)',
              color: 'color-mix(in srgb, var(--ff-primary) 55%, var(--ff-fg))',
            }}
          >
            Current plan
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">{entry.tagline}</p>
      <p className="mt-4 text-3xl font-semibold tabular-nums">
        ${entry.priceMonthlyUsd}
        <span className="text-sm font-normal text-[var(--ff-muted)]">/mo</span>
      </p>

      <ul className="mt-4 flex-1 space-y-2">
        {entry.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-sm leading-relaxed text-[var(--ff-muted)]">
            <Icon
              name="check"
              size={14}
              className="mt-[0.3rem] shrink-0 text-[var(--ff-muted)]"
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-4">
        {isCurrent ? (
          <button type="button" disabled aria-disabled="true" className={`${BTN_SECONDARY} w-full`}>
            Current plan
          </button>
        ) : upgrade && entry.stripePriceEnvKey ? (
          <form action={onCheckout}>
            <input type="hidden" name="plan" value={paidPlanOf(entry)} />
            <button type="submit" disabled={disabled} className={`${BTN_PRIMARY} w-full`}>
              Upgrade to {entry.name}
            </button>
          </form>
        ) : (
          <form action={onPortal}>
            <button type="submit" className={`${BTN_SECONDARY} w-full`}>
              {entry.id === 'free' ? 'Cancel via billing portal' : 'Switch via billing portal'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
