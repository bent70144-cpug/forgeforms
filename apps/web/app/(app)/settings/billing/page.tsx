import { PLAN_CATALOG, PLANS, type Plan } from '@formforge/core/billing';
import PlanCard from './PlanCard';
import { loadBillingSnapshot } from './_lib/billing-server';
import { openPortalAction, startCheckoutAction } from './_lib/actions';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { Icon } from '@/components/ui/icons';
import {
  BADGE_MUTED,
  BANNER_ERROR,
  BANNER_SUCCESS,
  BTN_SECONDARY,
} from '@/lib/ui';

// apps/web/app/(app)/settings/billing/page.tsx
// Billing settings: plan cards, seats, upgrade CTA — the ONLY UI surface with
// upgrade prompts. Stripe env is read server-side; when the gateway or price
// ids are missing the CTAs degrade to a disabled state instead of failing at
// submit time (honest fallback copy lives in ONE footnote below the grid).
//
// Presentation notes (Meridian): calm administrative print feel — mono
// uppercase kickers and hairline rules carry the structure, numbers set in
// JetBrains Mono, and the seats meter is the page's single fill of color.

type SearchParams = Record<string, string | string[] | undefined>;

// JetBrains Mono for kickers + numeric telemetry (Meridian typography rule).
const MONO = { fontFamily: 'var(--ff-font-mono)' } as const;
// 13px uppercase muted mono kickers carry the section structure.
const KICKER = 'text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--ff-muted)]';

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
        <p role="status" className={BANNER_SUCCESS}>
          {info}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={BANNER_ERROR}>
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
  // Presentation-only derived value for the seats meter (clamped 0–100).
  const seatPct =
    snapshot.seats.limit > 0
      ? Math.min(100, Math.round((snapshot.seats.used / snapshot.seats.limit) * 100))
      : 0;

  return (
    <div className="w-full max-w-5xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p
            className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ff-muted)]"
            style={MONO}
          >
            <span
              aria-hidden="true"
              className="h-px w-6"
              style={{ background: 'var(--ff-border-strong)' }}
            />
            Settings
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
            Billing
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--ff-muted)]">
            You’re on the{' '}
            <span className="font-medium text-[var(--ff-fg)]">{currentEntry.name}</span> plan.
            {snapshot.storageReady ? null : (
              <>
                {' '}
                <span className={BADGE_MUTED}>
                  Showing defaults — billing storage is still being set up
                </span>
              </>
            )}
          </p>
        </div>
        {snapshot.plan !== 'free' ? (
          <form action={openPortalAction}>
            <button type="submit" className={BTN_SECONDARY}>
              Manage billing
            </button>
          </form>
        ) : null}
      </header>

      <div className="mt-6">
        <SettingsTabs current="billing" />
      </div>

      <div className="mt-6 space-y-3">
        <CheckoutFlash params={params} />
      </div>

      <section aria-label="Seats" className="ff-panel mt-6 p-5 sm:p-6">
        <h2 className={KICKER} style={MONO}>
          Seats
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--ff-primary)_14%,transparent)] text-[var(--ff-primary)]"
          >
            <Icon name="creditCard" size={18} />
          </span>
          <div>
            <p className="text-2xl font-semibold tabular-nums" style={MONO}>
              {snapshot.seats.used}
              <span className="text-base font-normal text-[var(--ff-muted)]">
                {' '}
                / {snapshot.seats.limit} used
              </span>
            </p>
          </div>
          <p className="ml-auto max-w-[26rem] text-xs leading-relaxed text-[var(--ff-muted)]">
            Seat limits come from your plan (Free 1 · Pro 3 · Business 10).
          </p>
        </div>
        {/* Decorative meter — the numeric value above carries the information. */}
        <div
          aria-hidden="true"
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)]"
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${seatPct}%`, background: 'var(--ff-grad)' }}
          />
        </div>
      </section>

      <section aria-label="Plans" className="mt-8">
        <div className="flex items-center gap-4">
          <h2 className={KICKER} style={MONO}>
            Plans
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-[var(--ff-border)]" />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
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
          <p className="mt-4 text-xs leading-relaxed text-[var(--ff-muted)]">
            Online billing is not enabled on this deployment — Stripe isn’t configured, so upgrade
            and portal buttons stay disabled. Webhooks remain active at{' '}
            <code className="rounded bg-[var(--ff-bg-2)] px-1" style={MONO}>
              /api/webhooks/stripe
            </code>.
          </p>
        ) : null}
      </section>
    </div>
  );
}
