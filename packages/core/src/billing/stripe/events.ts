// packages/core/src/billing/stripe/events.ts
// Stripe webhook event parsing (Zod) — no SDK. Only the four event types the
// webhook endpoint must handle (spec §13, issue #23):
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted, invoice.payment_failed

import { z } from 'zod';
import { AppError } from "../../shared/errors.ts";
import { err, ok, type Result } from "../../shared/result.ts";;
import { isPaidPlan, type PaidPlan } from '../plans';

export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number(),
  livemode: z.boolean().optional(),
  data: z.object({
    object: z.record(z.string(), z.unknown()),
  }),
});

export type StripeEvent = z.infer<typeof stripeEventSchema>;

/** Parse the RAW request body into a Stripe event envelope. */
export function parseStripeEvent(rawBody: string): Result<StripeEvent, AppError> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return err(new AppError('VALIDATION', 'Webhook body is not valid JSON'));
  }
  const parsed = stripeEventSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      new AppError('VALIDATION', 'Webhook body does not match the Stripe event envelope',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      ),
    );
  }
  return ok(parsed.data);
}

/** Test fixture builder — mirrors what Stripe POSTs. */
export function buildStripeEvent(
  type: string,
  object: Record<string, unknown>,
  options: { id?: string; createdSeconds?: number; livemode?: boolean } = {},
): StripeEvent {
  return {
    id: options.id ?? `evt_test_${type.replace(/\./g, '_')}`,
    type,
    created: options.createdSeconds ?? 1_700_000_000,
    livemode: options.livemode ?? false,
    data: { object },
  };
}

// ---------------------------------------------------------------------------
// Stripe object schemas (narrow slices we actually read)

const metadataSchema = z.record(z.string(), z.unknown()).nullish();

const checkoutSessionObjectSchema = z.object({
  id: z.string(),
  mode: z.string(), // 'subscription' | 'payment' | 'setup'
  customer: z.string().nullish(),
  subscription: z.string().nullish(),
  status: z.string().nullish(),
  payment_status: z.string().nullish(),
  /** We set client_reference_id = workspaceId when creating the session. */
  client_reference_id: z.string().nullish(),
  metadata: metadataSchema,
});

const subscriptionObjectSchema = z.object({
  id: z.string(),
  customer: z.string().nullish(),
  status: z.string(),
  cancel_at_period_end: z.boolean().nullish(),
  current_period_end: z.number().nullish(),
  metadata: metadataSchema,
  items: z
    .object({
      data: z.array(z.object({ price: z.object({ id: z.string() }) })).min(1),
    })
    .nullish(),
});

const invoiceObjectSchema = z.object({
  id: z.string(),
  customer: z.string().nullish(),
  subscription: z.string().nullish(),
  attempt_count: z.number().nullish(),
});

export type CheckoutSessionObject = z.infer<typeof checkoutSessionObjectSchema>;
export type SubscriptionObject = z.infer<typeof subscriptionObjectSchema>;
export type InvoiceObject = z.infer<typeof invoiceObjectSchema>;

/** Our checkout sessions stamp metadata[workspaceId] and, on the
 * subscription, metadata[plan]; client_reference_id is a fallback. */
export function workspaceIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const value = metadata?.['workspaceId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Plan stamped on the subscription at checkout time (fallback when the
 * price id is not in the env price map, e.g. after a price rotation). */
export function planFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): PaidPlan | null {
  const value = metadata?.['plan'];
  return typeof value === 'string' && isPaidPlan(value) ? value : null;
}

export function parseCheckoutSessionObject(
  object: Record<string, unknown>,
): Result<CheckoutSessionObject, AppError> {
  const parsed = checkoutSessionObjectSchema.safeParse(object);
  return parsed.success ? ok(parsed.data) : invalidObject('checkout.session', parsed.error);
}

export function parseSubscriptionObject(
  object: Record<string, unknown>,
): Result<SubscriptionObject, AppError> {
  const parsed = subscriptionObjectSchema.safeParse(object);
  return parsed.success ? ok(parsed.data) : invalidObject('subscription', parsed.error);
}

export function parseInvoiceObject(object: Record<string, unknown>): Result<InvoiceObject, AppError> {
  const parsed = invoiceObjectSchema.safeParse(object);
  return parsed.success ? ok(parsed.data) : invalidObject('invoice', parsed.error);
}

function invalidObject(what: string, error: z.ZodError): Result<never, AppError> {
  return err(
    new AppError('VALIDATION', `Stripe ${what} object does not match expected shape`,
      error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    ),
  );
}
