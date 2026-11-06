import { PLAN_CATALOG, PLANS, type Plan } from '@formforge/core/billing';
import PlanCard from './PlanCard';
import { loadBillingSnapshot } from './_lib/billing-server';
import { openPortalAction, startCheckoutAction } from './_lib/actions';

// apps/web/app/(app)/settings/billing/page.tsx
// Billing settings (spec §13): plan cards, seats, upgrade CTA — the ONLY UI
// surface with upgrade prompts. Stripe env is read server-side; when the
// gateway or price ids are missing the CTAs degrade to a disabled state
// instead of failing at submit time.

type SearchParams = Record<string, string | string[] | undefined>;

const FLASH_INFO: Record<string, string> = {
  success: 'Subscription confirmed — your plan unlocks within seconds.',
  canceled: 'Checkout canceled — no changes were made.',
  returned: 'Back from the billing portal.',
};

const ERROR_TEXT: Record<string, string> = {
  VALIDATION: 'That request was not valid. Please retry.',
  CONFLICT: 'A billing session is already in progress. Try again in a moment.',
  INTERNAL:
    'Billing is temporarily unavailable (Stripe not configured or storage pending migration).',
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function CheckoutFlash({ params }: { params: SearchParams }) {
  const checkout = firstParam(params.checkout);
  const portal = firstParam(params.portal);
  const error = firstParam(params.error);
  const info = FLASH_INFO[checkout ?? portal ?? ''];
  return (
    <>
      {info ? <p className="ff-banner ff-banner-success">{info}</p> : null}
      {error ? (
        <p className="ff-banner ff-banner-error">{ERROR_TEXT[error] ?? `Billing error (${error}).`}</p>
      ) : null}
    </>
  );
}

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const snapshot = await loadBillingSnapshot();
  const currentEntry = PLAN_CATALOG[snapshot.plan];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-balance">Billing</h1>
          <p className="mt-1 text-base text-[var(--ff-muted)]">
            Current plan:{' '}
            <span className="font-semibold text-[var(--ff-fg)]">{currentEntry.name}</span>
            {snapshot.storageReady ? null : (
              <span className="ff-chip ml-2 align-middle">
                billing storage pending migration — showing defaults
              </span>
            )}
          </p>
        </div>
        {snapshot.plan !== 'free' ? (
          <form action={openPortalAction}>
            <button
              type="submit"
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-4 text-sm font-medium text-[var(--ff-fg)] transition-colors hover:border-[var(--ff-muted)] hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,var(--ff-card))]"
            >
              Manage billing
            </button>
          </form>
        ) : null}
      </header>

      <div className="mt-6 space-y-3">
        <CheckoutFlash params={params} />
      </div>

      <section
        aria-label="Seats"
        className="mt-6 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-6"
      >
        <h2 className="text-sm font-medium text-[var(--ff-muted)]">Team seats</h2>
        <p className="mt-2 text-2xl font-bold tabular-nums">
          {snapshot.seats.used}
          <span className="text-base font-normal text-[var(--ff-muted)]">
            {' '}
            / {snapshot.seats.limit} used
          </span>
        </p>
        <p className="mt-2 text-base text-[var(--ff-muted)]">
          Seat limits come from your plan (Free 1 · Pro 3 · Business 10).
        </p>
      </section>

      <section aria-label="Plans" className="mt-8">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          {PLANS.map((plan: Plan) => {
            const entry = PLAN_CATALOG[plan];
            const checkoutAvailable =
              snapshot.stripe.configured &&
              (plan === 'free' || Boolean(snapshot.stripe.priceReady[plan]));
            return (
              <PlanCard
                key={plan}
                entry={entry}
                currentPlan={snapshot.plan}
                checkoutAvailable={checkoutAvailable}
                onCheckout={startCheckoutAction}
                onPortal={openPortalAction}
              />
            );
          })}
        </div>
        {!snapshot.stripe.configured ? (
          <p className="mt-4 text-xs text-[var(--ff-muted)]">
            Upgrade buttons are disabled because STRIPE_SECRET_KEY is not set. Webhooks
            remain active at <code className="rounded bg-[var(--ff-bg)] px-1">/api/webhooks/stripe</code>.
          </p>
        ) : null}
      </section>
    </div>
  );
}
