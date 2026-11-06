// apps/web/app/(app)/settings/billing/_lib/billing-server.ts
// Settings→Billing data loading (server-only). Reuses the env-wired billing
// service assembled by the webhook route's _lib — one wiring, one cache.
//
// INTEGRATION-DEBT(T02): the billing tables (workspaces/memberships) come
// with T02's schema/migrations; until they exist every store call throws,
// so loadBillingSnapshot() degrades to the Free-plan view instead of 500s.
// INTEGRATION-DEBT(T03): there is no session yet — the workspace id comes
// from FORMFORGE_DEV_WORKSPACE_ID (or a fixed dev UUIDv7 placeholder).

import { ENTITLEMENTS, type Billing, type Entitlements, type Plan } from '@formforge/core/billing';
import {
  getBilling,
  stripeEnvStatus,
  type StripeEnvStatus,
} from '../../../../api/webhooks/stripe/_lib/billing-server';

/** Placeholder until T03 sessions exist. */
export function resolveWorkspaceId(env: NodeJS.ProcessEnv = process.env): string {
  return env.FORMFORGE_DEV_WORKSPACE_ID ?? '00000000-0000-7000-8000-000000000000';
}

export type BillingSnapshot = {
  workspaceId: string;
  /** false → billing storage unavailable (T02 migrations pending). */
  storageReady: boolean;
  plan: Plan;
  seats: { used: number; limit: number };
  entitlements: Entitlements;
  stripe: StripeEnvStatus;
};

/** Graceful snapshot for the settings page: never throws. */
export async function loadBillingSnapshot(
  billing: Billing = getBilling(),
): Promise<BillingSnapshot> {
  const workspaceId = resolveWorkspaceId();
  const stripe = stripeEnvStatus();
  try {
    const [plan, seats, entitlements] = await Promise.all([
      billing.effectivePlan(workspaceId),
      billing.seatUsage(workspaceId),
      billing.getEntitlements(workspaceId),
    ]);
    return { workspaceId, storageReady: true, plan, seats, entitlements, stripe };
  } catch (cause) {
    // T02 debt: billing tables not migrated yet — render the Free fallback.
    console.error(
      '[billing] snapshot unavailable (is billing storage migrated?)',
      cause instanceof Error ? cause.message : cause,
    );
    return {
      workspaceId,
      storageReady: false,
      plan: 'free',
      seats: { used: 0, limit: ENTITLEMENTS.free.seats },
      entitlements: ENTITLEMENTS.free,
      stripe,
    };
  }
}
