// packages/core/src/billing/service.ts
// The billing service factory — the ONLY plan-checking entry point for the
// rest of the codebase (spec §4: "one function only: can(workspaceId,
// capability): Promise<boolean> in billing. No inline plan checks anywhere
// else."). Owns: entitlements, checkout/portal via the injected gateway,
// seats, and the Stripe webhook application (idempotent by event id).

import { AppError, ok, type Ctx, type Result } from '../bridge';
import { createEntitlementsService, type EntitlementsService, type OverridesFn } from './can';
import type { Capability, Entitlements } from './entitlements';
import { planLimitError } from './entitlements';
import {
  classifyStripeEvent,
  INITIAL_BILLING_STATE,
  priceToPlanMap,
  reduceBillingEvent,
  type BillingState,
} from './lifecycle';
import { stripePriceFor, type PaidPlan, type Plan, type PlanPrices } from './plans';
import type { StripeGateway } from './stripe/gateway';
import { parseStripeEvent, type StripeEvent } from './stripe/events';
import { verifyStripeSignature } from './stripe/signature';
import type { BillingStore, WorkspaceBillingRow } from './store';

export type BillingOptions = {
  store: BillingStore;
  /** Real or fake gateway. Absent → checkout/portal return INTERNAL errors. */
  stripe?: StripeGateway;
  /** Stripe price ids (from STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS env). */
  prices?: PlanPrices;
  /** STRIPE_WEBHOOK_SECRET — required by handleStripeWebhook. */
  webhookSecret?: string;
  /** App origin used for default checkout success/cancel URLs. */
  appUrl?: string;
  /** Injected clock (spec §4). */
  now?: () => Date;
  /** Entitlements cache TTL (default 15s, unlocks within the 30s bar). */
  cacheTtlMs?: number;
  /** Per-workspace entitlement overrides (comp'd/grandfathered grants). */
  entitlementOverrides?: OverridesFn;
};

export type Billing = EntitlementsService & {
  /** Start a Stripe Checkout session for a paid plan. */
  startCheckout(
    ctx: Ctx,
    input: { plan: PaidPlan; successUrl?: string; cancelUrl?: string },
  ): Promise<Result<{ url: string; sessionId: string }, AppError>>;
  /** Open the Stripe Customer Portal (manage payment method / cancel). */
  createPortalSession(
    ctx: Ctx,
    input?: { returnUrl?: string },
  ): Promise<Result<{ url: string }, AppError>>;
  /** Seats against the plan matrix (spec §13 "Team seats": 1/3/10). */
  seatUsage(workspaceId: string): Promise<{ used: number; limit: number }>;
  /** Seat check for the member-invitation flow (T04 owns the UI). */
  canInviteMember(workspaceId: string): Promise<
    Result<{ used: number; limit: number }, AppError>
  >;
  /** Apply one verified, parsed Stripe event to the workspace (idempotent
   * by event id). Used directly by the webhook route and tests. */
  applyStripeEvent(event: StripeEvent): Promise<Result<ApplyOutcome, AppError>>;
  /** Verify signature → parse → apply. The webhook route is a thin adapter
   * over this; error.code VALIDATION maps to HTTP 400. */
  handleStripeWebhook(input: {
    rawBody: string;
    signatureHeader: string;
  }): Promise<Result<ApplyOutcome, AppError>>;
};

export type ApplyOutcome = {
  /** Billing columns were updated. */
  applied: boolean;
  /** Event type is not one we handle (still ack 200 to Stripe). */
  ignored: boolean;
  /** Event id already processed (issue #23: "webhook replayed twice updates
   * plan once"). */
  duplicate: boolean;
  workspaceId: string | null;
  plan?: Plan;
};

const DEFAULT_APP_URL = 'http://localhost:3000';

function rowToState(row: WorkspaceBillingRow | null): BillingState {
  if (!row) return INITIAL_BILLING_STATE;
  return {
    plan: row.plan,
    subscriptionStatus: null,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

export function createBilling(options: BillingOptions): Billing {
  const now = options.now ?? (() => new Date());
  const appUrl = options.appUrl ?? DEFAULT_APP_URL;
  const priceToPlan = priceToPlanMap(options.prices ?? {});

  const entitlements: EntitlementsService = createEntitlementsService({
    loadPlan: async (workspaceId) => {
      const row = await options.store.getWorkspaceBilling(workspaceId);
      return row?.plan ?? null;
    },
    nowMs: () => now().getTime(),
    cacheTtlMs: options.cacheTtlMs,
    entitlementOverrides: options.entitlementOverrides,
  });

  async function resolveWorkspaceIdForEvent(
    event: StripeEvent,
    metadataWorkspaceId: string | null,
    customerId: string | null,
  ): Promise<string | null> {
    if (metadataWorkspaceId) return metadataWorkspaceId;
    if (customerId) return options.store.findWorkspaceIdByStripeCustomer(customerId);
    return null;
  }

  const billing: Billing = {
    ...entitlements,

    async startCheckout(ctx, input) {
      if (!options.stripe) {
        return {
          ok: false,
          error: new AppError('INTERNAL', 'Stripe gateway is not configured'),
        };
      }
      const priceId = stripePriceFor(input.plan, options.prices ?? {});
      if (!priceId) {
        return {
          ok: false,
          error: new AppError(
            'INTERNAL',
            `Stripe price for "${input.plan}" is not configured (set the env price id)`,
          ),
        };
      }
      const row = await options.store.getWorkspaceBilling(ctx.workspaceId);
      const session = await options.stripe.createCheckoutSession({
        workspaceId: ctx.workspaceId,
        plan: input.plan,
        stripeCustomerId: row?.stripeCustomerId ?? null,
        successUrl: input.successUrl ?? `${appUrl}/settings/billing?checkout=success`,
        cancelUrl: input.cancelUrl ?? `${appUrl}/settings/billing?checkout=canceled`,
      });
      if (!session.ok) return session;
      return ok({ url: session.value.url, sessionId: session.value.id });
    },

    async createPortalSession(ctx, input) {
      if (!options.stripe) {
        return {
          ok: false,
          error: new AppError('INTERNAL', 'Stripe gateway is not configured'),
        };
      }
      const row = await options.store.getWorkspaceBilling(ctx.workspaceId);
      if (!row?.stripeCustomerId) {
        return {
          ok: false,
          error: new AppError(
            'VALIDATION',
            'No Stripe customer for this workspace yet — start a subscription first',
          ),
        };
      }
      return options.stripe.createPortalSession({
        stripeCustomerId: row.stripeCustomerId,
        returnUrl: input?.returnUrl ?? `${appUrl}/settings/billing?portal=returned`,
      });
    },

    async seatUsage(workspaceId) {
      const [used, entitlementsRow] = await Promise.all([
        options.store.countMembers(workspaceId),
        entitlements.getEntitlements(workspaceId),
      ]);
      return { used, limit: entitlementsRow.seats };
    },

    async canInviteMember(workspaceId) {
      const { used, limit } = await billing.seatUsage(workspaceId);
      if (used >= limit) {
        return {
          ok: false,
          error: planLimitError('seats' satisfies Capability, used + 1),
        };
      }
      return ok({ used, limit });
    },

    async applyStripeEvent(event): Promise<Result<ApplyOutcome, AppError>> {
      const classified = classifyStripeEvent(event, priceToPlan);
      if (!classified.ok) return classified;
      const parsed = classified.value;
      if (parsed.kind === 'unhandled') {
        return ok({ applied: false, ignored: true, duplicate: false, workspaceId: null });
      }

      // Idempotency by event id (spec §13) — checked BEFORE any writes.
      if (await options.store.isEventProcessed(event.id)) {
        return ok({
          applied: false,
          ignored: false,
          duplicate: true,
          workspaceId: parsed.workspaceId,
        });
      }

      const workspaceId = await resolveWorkspaceIdForEvent(
        event,
        parsed.workspaceId,
        parsed.customerId,
      );
      if (!workspaceId) {
        // Not our customer (or metadata lost) — ack so Stripe stops retrying.
        return ok({ applied: false, ignored: false, duplicate: false, workspaceId: null });
      }

      const current = await options.store.getWorkspaceBilling(workspaceId);
      const next = reduceBillingEvent(rowToState(current), parsed);
      const applied = await options.store.setWorkspaceBilling({
        workspaceId,
        plan: next.plan,
        stripeCustomerId: next.stripeCustomerId,
        stripeSubscriptionId: next.stripeSubscriptionId,
      });
      if (!applied) {
        // Workspace row vanished between lookup and update.
        return ok({ applied: false, ignored: false, duplicate: false, workspaceId });
      }

      await options.store.markEventProcessed({ eventId: event.id, workspaceId, type: event.type });
      const planChanged = current?.plan !== next.plan;
      if (planChanged) entitlements.invalidateEntitlementsCache(workspaceId);
      return ok({
        applied: true,
        ignored: false,
        duplicate: false,
        workspaceId,
        plan: next.plan,
      });
    },

    async handleStripeWebhook({ rawBody, signatureHeader }) {
      if (!options.webhookSecret) {
        return {
          ok: false,
          error: new AppError('INTERNAL', 'STRIPE_WEBHOOK_SECRET is not configured'),
        };
      }
      const verified = verifyStripeSignature(rawBody, signatureHeader, options.webhookSecret, {
        nowMs: now().getTime(),
      });
      if (!verified.ok) return verified;
      const parsedEvent = parseStripeEvent(rawBody);
      if (!parsedEvent.ok) return parsedEvent;
      return billing.applyStripeEvent(parsedEvent.value);
    },
  };

  return billing;
}

export type { Capability, Entitlements };
