// packages/core/src/billing/stripe/gateway.ts
// StripeGateway port — every Stripe side effect in FormForge goes through
// this interface (spec §3: side effects are injected, never inline).
// Two adapters live beside it:
//   • fetch-gateway.ts — zero-dependency REST adapter for production
//   • fake-gateway.ts  — recording fake for tests (no keys in this sandbox)

import { type AppError } from "../../shared/errors.ts";
import { type Result } from "../../shared/result.ts";;
import type { PaidPlan } from '../plans';

export type CheckoutSessionInput = {
  workspaceId: string;
  plan: PaidPlan;
  /** Existing Stripe customer, when the workspace has one already. */
  stripeCustomerId: string | null;
  /** Used to create a customer on first checkout when no id exists yet. */
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionResult = {
  id: string;
  url: string;
  plan: PaidPlan;
  workspaceId: string;
};

export type PortalSessionInput = {
  stripeCustomerId: string;
  returnUrl: string;
};

export type PortalSessionResult = {
  id: string;
  url: string;
};

export interface StripeGateway {
  createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<Result<CheckoutSessionResult, AppError>>;
  createPortalSession(input: PortalSessionInput): Promise<Result<PortalSessionResult, AppError>>;
}
