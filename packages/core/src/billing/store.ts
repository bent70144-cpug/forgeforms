// packages/core/src/billing/store.ts
// Persistence seam for the billing module. `packages/db` provides the real
// implementation (src/repositories/billing.ts); tests provide in-memory fakes.
// The interface is intentionally structural — the db package must not depend
// on @formforge/core (dependency direction: core ← db implementation).

import type { Plan } from './plans';

export type WorkspaceBillingRow = {
  workspaceId: string;
  plan: Plan;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

/** Everything the billing module needs from the database, scoped to the
 * workspace by the repository layer (spec §3: repositories live in
 * packages/db; only the owning module imports its repositories). */
export interface BillingStore {
  getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBillingRow | null>;

  /** Reverse lookup for webhooks: Stripe events carry a customer id, not a
   * workspace id, when our metadata is missing. */
  findWorkspaceIdByStripeCustomer(stripeCustomerId: string): Promise<string | null>;

  /** Absolute write of the billing columns derived from the webhook state
   * machine. Returns false when the workspace row no longer exists. */
  setWorkspaceBilling(input: {
    workspaceId: string;
    plan: Plan;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  }): Promise<boolean>;

  /** Webhook idempotency (issue #23): "webhook replayed twice updates plan
   * once". Backed by audit_log until/if a dedicated table lands. */
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(input: { eventId: string; workspaceId: string; type: string }): Promise<void>;

  /** Seats (spec §13 row "Team seats"): current member count, owner included. */
  countMembers(workspaceId: string): Promise<number>;

  /** Monthly usage metric for fair-use reporting (usage_counters, spec §6).
   * `period` is `YYYY-MM`. Zero when no counter row exists yet. */
  getMonthlySubmissions(workspaceId: string, period: string): Promise<number>;
}
