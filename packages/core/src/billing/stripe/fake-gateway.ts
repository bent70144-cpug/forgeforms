// packages/core/src/billing/stripe/fake-gateway.ts
// Recording fake StripeGateway for unit tests — no network, no keys.
// Issue #23 hard rule: everything Stripe sits behind interfaces and unit
// tests use the fake gateway.

import { err, ok, type AppError, type Result } from '../../bridge';
import type { PaidPlan } from '../plans';
import type {
  CheckoutSessionInput,
  CheckoutSessionResult,
  PortalSessionInput,
  PortalSessionResult,
  StripeGateway,
} from './gateway';

export type FakeGatewayCall =
  | { kind: 'checkout'; input: CheckoutSessionInput; at: Date }
  | { kind: 'portal'; input: PortalSessionInput; at: Date };

export type FakeStripeGateway = StripeGateway & {
  calls: FakeGatewayCall[];
  /** When set, the next call fails with this error. Reset after use. */
  failNext: AppError | null;
  checkoutCalls: FakeGatewayCall[];
  portalCalls: FakeGatewayCall[];
};

export type FakeGatewayOptions = {
  /** Base URL prefix of the fake hosted pages. */
  urlPrefix?: string;
  /** Deterministic clock for call recording. */
  now?: () => Date;
};

let fakeCounter = 0;

export function createFakeStripeGateway(options: FakeGatewayOptions = {}): FakeStripeGateway {
  const prefix = options.urlPrefix ?? 'https://billing.fake.stripe.test';
  const now = options.now ?? (() => new Date());
  const fake: FakeStripeGateway = {
    calls: [],
    failNext: options.failNext ?? null,
    checkoutCalls: [],
    portalCalls: [],

    async createCheckoutSession(input): Promise<Result<CheckoutSessionResult, AppError>> {
      fake.calls.push({ kind: 'checkout', input, at: now() });
      fake.checkoutCalls = fake.calls.filter((call) => call.kind === 'checkout');
      if (fake.failNext) {
        const failure = fake.failNext;
        fake.failNext = null;
        return err(failure);
      }
      fakeCounter += 1;
      return ok({
        id: `cs_fake_${fakeCounter}`,
        url: `${prefix}/checkout/cs_fake_${fakeCounter}`,
        plan: input.plan,
        workspaceId: input.workspaceId,
      });
    },

    async createPortalSession(input): Promise<Result<PortalSessionResult, AppError>> {
      fake.calls.push({ kind: 'portal', input, at: now() });
      fake.portalCalls = fake.calls.filter((call) => call.kind === 'portal');
      if (fake.failNext) {
        const failure = fake.failNext;
        fake.failNext = null;
        return err(failure);
      }
      fakeCounter += 1;
      return ok({ id: `bps_fake_${fakeCounter}`, url: `${prefix}/portal/bps_fake_${fakeCounter}` });
    },
  };
  return fake;
}
