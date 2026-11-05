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
      {info ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {info}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ERROR_TEXT[error] ?? `Billing error (${error}).`}
        </p>
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
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Current plan:{' '}
            <span className="font-semibold text-slate-900">{currentEntry.name}</span>
            {snapshot.storageReady ? null : (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                billing storage pending migration — showing defaults
              </span>
            )}
          </p>
        </div>
        {snapshot.plan !== 'free' ? (
          <form action={openPortalAction}>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Manage billing
            </button>
          </form>
        ) : null}
      </header>

      <div className="mt-6">
        <CheckoutFlash params={params} />
      </div>

      <section aria-label="Seats" className="mt-6 rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Team seats
        </h2>
        <p className="mt-2 text-2xl font-bold">
          {snapshot.seats.used}
          <span className="text-base font-normal text-slate-500"> / {snapshot.seats.limit} used</span>
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Members are invited from Settings → Team. Seat limits come from your plan
          (Free 1 · Pro 3 · Business 10).
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
          <p className="mt-4 text-xs text-slate-400">
            Upgrade buttons are disabled because STRIPE_SECRET_KEY is not set. Webhooks
            remain active at <code>/api/webhooks/stripe</code>.
          </p>
        ) : null}
      </section>
    </main>
  );
}
