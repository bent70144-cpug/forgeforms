// packages/core/src/billing/stripe/fetch-gateway.ts
// Zero-dependency StripeGateway adapter over the Stripe REST API using
// global fetch. No stripe npm package — the sandbox has no keys and tests
// inject a fetch stub (issue #23 hard rule: "Do NOT add the stripe SDK").

import { AppError } from "../../shared/errors.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { PaidPlan } from '../plans';
import type {
  CheckoutSessionInput,
  PortalSessionInput,
  StripeGateway,
} from './gateway';

export type StripeGatewayConfig = {
  /** Secret API key (sk_…). Test-mode keys are fine. */
  apiKey: string;
  /** Stripe price ids from env (STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS).
   * Partial: a missing price id fails the specific checkout with a typed
   * INTERNAL error instead of blocking gateway construction. */
  prices: Partial<Record<PaidPlan, string>>;
  /** Override for tests; default https://api.stripe.com/v1 */
  apiBaseUrl?: string;
  /** Override for tests; default global fetch. */
  fetchImpl?: typeof fetch;
};

type StripeApiError = { error?: { message?: string; type?: string; code?: string } };

export function createStripeGateway(config: StripeGatewayConfig): StripeGateway {
  const apiBaseUrl = config.apiBaseUrl ?? 'https://api.stripe.com/v1';
  const doFetch = config.fetchImpl ?? fetch;

  async function post(
    path: string,
    params: Record<string, string>,
  ): Promise<Result<Record<string, unknown>, AppError>> {
    let response: Response;
    try {
      response = await doFetch(`${apiBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
      });
    } catch (cause) {
      return err(
        new AppError('INTERNAL', 'Stripe request failed (network error)', [
          { path, message: cause instanceof Error ? cause.message : String(cause) },
        ]),
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    if (!response.ok) {
      const apiError = body as StripeApiError;
      return err(
        new AppError('INTERNAL', apiError.error?.message ?? `Stripe error (HTTP ${response.status})`, [
          { path, message: `HTTP ${response.status}` },
          ...(apiError.error?.type ? [{ path: 'stripe.error.type', message: apiError.error.type }] : []),
          ...(apiError.error?.code ? [{ path: 'stripe.error.code', message: apiError.error.code }] : []),
        ]),
      );
    }
    return ok(body);
  }

  return {
    async createCheckoutSession(input: CheckoutSessionInput) {
      const priceId = config.prices[input.plan];
      if (!priceId) {
        return err(
          new AppError(
            'INTERNAL',
            `Stripe price for plan "${input.plan}" is not configured (missing env price id)`,
          ),
        );
      }

      // Metadata is the ONLY way the webhook can attribute the checkout back
      // to the workspace — client_reference_id is a fallback.
      const metadata: Record<string, string> = {
        'metadata[workspaceId]': input.workspaceId,
        'metadata[plan]': input.plan,
        'subscription_data[metadata][workspaceId]': input.workspaceId,
        'subscription_data[metadata][plan]': input.plan,
      };

      const params: Record<string, string> = {
        mode: 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        client_reference_id: input.workspaceId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: 'true',
        ...metadata,
      };
      if (input.stripeCustomerId) params['customer'] = input.stripeCustomerId;
      else if (input.customerEmail) params['customer_email'] = input.customerEmail;

      const result = await post('/checkout/sessions', params);
      if (!result.ok) return result;
      const { id, url } = result.value as { id?: unknown; url?: unknown };
      if (typeof id !== 'string' || typeof url !== 'string') {
        return err(new AppError('INTERNAL', 'Stripe checkout session response missing id/url'));
      }
      return ok({ id, url, plan: input.plan, workspaceId: input.workspaceId });
    },

    async createPortalSession(input: PortalSessionInput) {
      const result = await post('/billing_portal/sessions', {
        customer: input.stripeCustomerId,
        return_url: input.returnUrl,
      });
      if (!result.ok) return result;
      const { id, url } = result.value as { id?: unknown; url?: unknown };
      if (typeof id !== 'string' || typeof url !== 'string') {
        return err(new AppError('INTERNAL', 'Stripe portal session response missing id/url'));
      }
      return ok({ id, url });
    },
  };
}
