// packages/core/src/billing/lifecycle.ts
// Subscription lifecycle state machine, driven purely by Stripe webhook
// events (spec §13, issue #23). Pure functions only — the webhook service
// persists the resulting BillingState through the BillingStore.

import { err, ok, type AppError, type Result } from '../bridge';
import type { PaidPlan, Plan } from './plans';
import {
  parseCheckoutSessionObject,
  parseInvoiceObject,
  parseSubscriptionObject,
  planFromMetadata,
  workspaceIdFromMetadata,
  type StripeEvent,
} from './stripe/events';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'canceled'
  | 'paused';

/** Subscription grants the plan. */
export const ACTIVE_STATUSES: readonly SubscriptionStatus[] = ['active', 'trialing'];
/** Dunning/collection window: keep the plan (grace), Stripe decides next. */
export const GRACE_STATUSES: readonly SubscriptionStatus[] = ['past_due', 'unpaid', 'incomplete'];
/** Re-lock everything back to free. */
export const TERMINAL_STATUSES: readonly SubscriptionStatus[] = [
  'canceled',
  'incomplete_expired',
  'paused',
];

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (
    ACTIVE_STATUSES.includes(value as SubscriptionStatus) ||
    GRACE_STATUSES.includes(value as SubscriptionStatus) ||
    TERMINAL_STATUSES.includes(value as SubscriptionStatus)
  );
}

export type BillingState = {
  plan: Plan;
  subscriptionStatus: SubscriptionStatus | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export const INITIAL_BILLING_STATE: BillingState = {
  plan: 'free',
  subscriptionStatus: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

export type ParsedBillingEvent =
  | {
      kind: 'checkout.completed';
      eventId: string;
      workspaceId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      plan: PaidPlan | null;
    }
  | {
      kind: 'subscription.updated';
      eventId: string;
      workspaceId: string | null;
      customerId: string | null;
      subscriptionId: string;
      plan: PaidPlan | null;
      status: SubscriptionStatus;
      cancelAtPeriodEnd: boolean;
      periodEndSeconds: number | null;
    }
  | {
      kind: 'subscription.deleted';
      eventId: string;
      workspaceId: string | null;
      customerId: string | null;
      subscriptionId: string;
    }
  | {
      kind: 'invoice.payment_failed';
      eventId: string;
      workspaceId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      attemptCount: number | null;
    }
  | { kind: 'unhandled'; eventId: string; type: string };

/** Map Stripe price ids → plans (inverted env price map). */
export function priceToPlanMap(prices: Partial<Record<PaidPlan, string>>): Record<string, PaidPlan> {
  const map: Record<string, PaidPlan> = {};
  for (const [plan, priceId] of Object.entries(prices)) {
    if (typeof priceId === 'string' && priceId.length > 0) map[priceId] = plan as PaidPlan;
  }
  return map;
}

function planFromPriceId(
  event: StripeEvent,
  priceToPlan: Record<string, PaidPlan>,
): PaidPlan | null {
  const object = event.data.object as { items?: { data?: Array<{ price?: { id?: unknown } }> } };
  const firstItem = object.items?.data?.[0];
  const priceId = firstItem?.price?.id;
  if (typeof priceId === 'string') {
    const plan = priceToPlan[priceId];
    if (plan) return plan;
  }
  // Fallback: plan stamped in subscription metadata at checkout time.
  const metadata = event.data.object['metadata'];
  return planFromMetadata(
    typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, unknown>)
      : undefined,
  );
}

function workspaceIdOf(event: StripeEvent): string | null {
  const metadata = event.data.object['metadata'];
  return workspaceIdFromMetadata(
    typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, unknown>)
      : undefined,
  );
}

/** Classify a parsed Stripe event into the lifecycle vocabulary. Malformed
 * payloads for handled types are a VALIDATION error (Stripe never sends them;
 * fail loud so the bug is visible in webhook logs). */
export function classifyStripeEvent(
  event: StripeEvent,
  priceToPlan: Record<string, PaidPlan>,
): Result<ParsedBillingEvent, AppError> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const parsed = parseCheckoutSessionObject(event.data.object);
      if (!parsed.ok) return parsed;
      const session = parsed.value;
      return ok({
        kind: 'checkout.completed',
        eventId: event.id,
        workspaceId: workspaceIdOf(event) ?? (session.client_reference_id || null),
        customerId: session.customer ?? null,
        subscriptionId: session.subscription ?? null,
        plan: session.mode === 'subscription' ? planFromMetadata(session.metadata) : null,
      });
    }
    case 'customer.subscription.updated': {
      const parsed = parseSubscriptionObject(event.data.object);
      if (!parsed.ok) return parsed;
      const sub = parsed.value;
      return ok({
        kind: 'subscription.updated',
        eventId: event.id,
        workspaceId: workspaceIdOf(event),
        customerId: sub.customer ?? null,
        subscriptionId: sub.id,
        plan: planFromPriceId(event, priceToPlan),
        status: isSubscriptionStatus(sub.status) ? sub.status : 'incomplete',
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        periodEndSeconds: sub.current_period_end ?? null,
      });
    }
    case 'customer.subscription.deleted': {
      const parsed = parseSubscriptionObject(event.data.object);
      if (!parsed.ok) return parsed;
      const sub = parsed.value;
      return ok({
        kind: 'subscription.deleted',
        eventId: event.id,
        workspaceId: workspaceIdOf(event),
        customerId: sub.customer ?? null,
        subscriptionId: sub.id,
      });
    }
    case 'invoice.payment_failed': {
      const parsed = parseInvoiceObject(event.data.object);
      if (!parsed.ok) return parsed;
      const invoice = parsed.value;
      return ok({
        kind: 'invoice.payment_failed',
        eventId: event.id,
        workspaceId: workspaceIdOf(event),
        customerId: invoice.customer ?? null,
        subscriptionId: invoice.subscription ?? null,
        attemptCount: invoice.attempt_count ?? null,
      });
    }
    default:
      return ok({ kind: 'unhandled', eventId: event.id, type: event.type });
  }
}

/** Apply one parsed event to the current state.
 * Policy (SPEC-NOTE: spec pins only "update workspaces.plan"; the dunning
 * details below are the minimal safe reading):
 * - checkout.session.completed (subscription mode) → adopt plan + ids.
 * - subscription.updated → active/trialing adopts the mapped plan; grace
 *   statuses (past_due/unpaid/incomplete) keep the paid plan; terminal
 *   statuses re-lock to free. cancel_at_period_end does NOT downgrade yet —
 *   Stripe sends customer.subscription.deleted at period end.
 * - subscription.deleted → back to free, subscription id cleared.
 * - invoice.payment_failed → mark status past_due only; no auto-downgrade
 *   (Stripe drives the final decision via subscription events; fair-use
 *   review is manual per spec §13). */
export function reduceBillingEvent(state: BillingState, event: ParsedBillingEvent): BillingState {
  switch (event.kind) {
    case 'unhandled':
      return state;
    case 'checkout.completed': {
      if (!event.subscriptionId) return state; // non-subscription checkout
      return {
        plan: event.plan ?? state.plan,
        subscriptionStatus: 'active',
        stripeCustomerId: event.customerId ?? state.stripeCustomerId,
        stripeSubscriptionId: event.subscriptionId,
      };
    }
    case 'subscription.updated': {
      const customerId = event.customerId ?? state.stripeCustomerId;
      if (ACTIVE_STATUSES.includes(event.status)) {
        return {
          plan: event.plan ?? state.plan,
          subscriptionStatus: event.status,
          stripeCustomerId: customerId,
          stripeSubscriptionId: event.subscriptionId,
        };
      }
      if (GRACE_STATUSES.includes(event.status)) {
        return {
          ...state,
          plan: event.plan ?? state.plan,
          subscriptionStatus: event.status,
          stripeCustomerId: customerId,
          stripeSubscriptionId: event.subscriptionId,
        };
      }
      // TERMINAL_STATUSES
      return {
        ...state,
        plan: 'free',
        subscriptionStatus: event.status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: event.subscriptionId,
      };
    }
    case 'subscription.deleted':
      return {
        plan: 'free',
        subscriptionStatus: 'canceled',
        stripeCustomerId: event.customerId ?? state.stripeCustomerId,
        stripeSubscriptionId: null,
      };
    case 'invoice.payment_failed':
      return {
        ...state,
        subscriptionStatus:
          state.subscriptionStatus === 'canceled' ? state.subscriptionStatus : 'past_due',
        stripeCustomerId: event.customerId ?? state.stripeCustomerId,
      };
  }
}
