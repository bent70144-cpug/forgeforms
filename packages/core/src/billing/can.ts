// packages/core/src/billing/can.ts
// The feature-gating service (spec §4): "one function only:
// can(workspaceId, capability): Promise<boolean> in billing. No inline plan
// checks anywhere else." Reads a cached entitlements object derived from
// `workspaces.plan` (spec §13) via the injected `loadPlan` loader.

import type { Capability, Entitlements } from './entitlements';
import { ENTITLEMENTS, entitlementSatisfies } from './entitlements';
import type { Plan } from './plans';

/** Loader for the workspace's current plan. Null → workspace unknown;
 * it is treated as `free` (fail closed for paid features) so callers get a
 * deterministic answer instead of a throw on a missing row. */
export type LoadPlanFn = (workspaceId: string) => Promise<Plan | null>;

/** Per-workspace entitlement overrides (e.g. comp'd/grandfathered grants).
 * Merged ON TOP of the plan matrix. Returns undefined → no overrides. */
export type OverridesFn = (
  workspaceId: string,
) => Partial<Entitlements> | undefined | Promise<Partial<Entitlements> | undefined>;

export type EntitlementsServiceOptions = {
  loadPlan: LoadPlanFn;
  /** Injected clock (spec §4: never `new Date()` inside services). */
  nowMs?: () => number;
  /** Entitlements cache TTL. Default 15s — the issue #23 acceptance bar is
   * "Stripe upgrade unlocks capabilities within 30s"; webhooks also
   * invalidate explicitly on plan changes. */
  cacheTtlMs?: number;
  entitlementOverrides?: OverridesFn;
};

export type EntitlementsService = {
  /** THE gating function. Spec-pinned signature. */
  can(workspaceId: string, capability: Capability): Promise<boolean>;
  /** Full matrix row for the workspace's effective plan (+ overrides).
   * Use for numeric quota math (upload size, domain count) — still no
   * inline plan checks: the values come from billing. */
  getEntitlements(workspaceId: string): Promise<Entitlements>;
  /** Effective plan (cached). Unknown workspaces resolve to 'free'. */
  effectivePlan(workspaceId: string): Promise<Plan>;
  /** Invalidate the cache — called by the Stripe webhook after a plan
   * change, and available to tests/admin tools. */
  invalidateEntitlementsCache(workspaceId?: string): void;
};

const DEFAULT_CACHE_TTL_MS = 15_000;

type CacheEntry = { plan: Plan | null; expiresAtMs: number };

export function createEntitlementsService(options: EntitlementsServiceOptions): EntitlementsService {
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const nowMs = options.nowMs ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  async function effectivePlan(workspaceId: string): Promise<Plan> {
    const cached = cache.get(workspaceId);
    if (cached && cached.expiresAtMs > nowMs()) {
      return cached.plan ?? 'free';
    }
    const plan = await options.loadPlan(workspaceId);
    cache.set(workspaceId, { plan, expiresAtMs: nowMs() + ttlMs });
    return plan ?? 'free';
  }

  async function getEntitlements(workspaceId: string): Promise<Entitlements> {
    const plan = await effectivePlan(workspaceId);
    const base = ENTITLEMENTS[plan];
    const overrides = options.entitlementOverrides
      ? await options.entitlementOverrides(workspaceId)
      : undefined;
    return overrides ? { ...base, ...overrides } : base;
  }

  return {
    can: async (workspaceId, capability) => {
      const entitlements = await getEntitlements(workspaceId);
      return entitlementSatisfies(entitlements[capability]);
    },
    getEntitlements,
    effectivePlan,
    invalidateEntitlementsCache: (workspaceId?: string) => {
      if (workspaceId === undefined) cache.clear();
      else cache.delete(workspaceId);
    },
  };
}
