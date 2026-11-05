// packages/core/src/billing/index.ts
// Public interface of the billing module (spec §3: modules expose only
// index.ts — services take a Ctx, types, error classes).

// Types
export type { ErrorCode, Result, Ctx } from '../bridge';
export { AppError, ok, err } from '../bridge';
export type { Plan, PaidPlan, PlanCatalogEntry, PlanPrices, StripePriceEnvKey } from './plans';
export type { Entitlements, EntitlementValue, Capability } from './entitlements';
export type {
  BillingStore,
  WorkspaceBillingRow,
} from './store';
export type { LoadPlanFn, OverridesFn, EntitlementsService, EntitlementsServiceOptions } from './can';
export type {
  Billing,
  BillingOptions,
  ApplyOutcome,
} from './service';
export type {
  SubscriptionStatus,
  BillingState,
  ParsedBillingEvent,
} from './lifecycle';
export type {
  StripeGateway,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PortalSessionInput,
  PortalSessionResult,
} from './stripe/gateway';
export type { StripeGatewayConfig } from './stripe/fetch-gateway';
export type { FakeStripeGateway, FakeGatewayCall, FakeGatewayOptions } from './stripe/fake-gateway';
export type { StripeEvent, HandledEventType, CheckoutSessionObject, SubscriptionObject, InvoiceObject } from './stripe/events';

// Data (pure)
export { PLANS, PLAN_CATALOG, isPlan, isPaidPlan, planRank, isUpgrade, stripePriceFor } from './plans';
export {
  CAPABILITIES,
  ENTITLEMENTS,
  FAIR_USE_SUBMISSIONS_PER_MONTH,
  entitlementSatisfies,
  requiredPlanFor,
  planLimitError,
  isCapability,
} from './entitlements';
export {
  ACTIVE_STATUSES,
  GRACE_STATUSES,
  TERMINAL_STATUSES,
  INITIAL_BILLING_STATE,
  isSubscriptionStatus,
  priceToPlanMap,
  classifyStripeEvent,
  reduceBillingEvent,
} from './lifecycle';
export { HANDLED_EVENT_TYPES, stripeEventSchema } from './stripe/events';

// Services
export { createBilling } from './service';
export { createEntitlementsService } from './can';
export { createStripeGateway } from './stripe/fetch-gateway';
export { createFakeStripeGateway } from './stripe/fake-gateway';
export {
  verifyStripeSignature,
  signStripeEvent,
  signStripePayload,
  DEFAULT_TOLERANCE_SECONDS,
} from './stripe/signature';
export {
  parseStripeEvent,
  buildStripeEvent,
  parseCheckoutSessionObject,
  parseSubscriptionObject,
  parseInvoiceObject,
  workspaceIdFromMetadata,
  planFromMetadata,
} from './stripe/events';
