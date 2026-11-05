// tests: can() — THE gating function (spec §4), cached plan + overrides.
import { describe, expect, it, vi } from 'vitest';
import { createEntitlementsService, type LoadPlanFn } from './can';

function fakeNow(): () => number {
  let tick = 1_700_000_000_000;
  return () => (tick += 1000);
}

function planLoader(map: Record<string, 'free' | 'pro' | 'business'>): LoadPlanFn & {
  calls: string[];
} {
  const calls: string[] = [];
  const fn = Object.assign(
    async (workspaceId: string) => {
      calls.push(workspaceId);
      return map[workspaceId] ?? null;
    },
    { calls },
  );
  return fn;
}

describe('can() — plan gating per §13', () => {
  it('free workspace: branding/analytics/partial/api/ai locked, webhooks open', async () => {
    const service = createEntitlementsService({
      loadPlan: planLoader({ ws_free: 'free' }),
    });
    await expect(service.can('ws_free', 'removeBranding')).resolves.toBe(false);
    await expect(service.can('ws_free', 'analytics')).resolves.toBe(false);
    await expect(service.can('ws_free', 'partialSubmissions')).resolves.toBe(false);
    await expect(service.can('ws_free', 'apiAccess')).resolves.toBe(false);
    await expect(service.can('ws_free', 'aiDrafts')).resolves.toBe(false);
    await expect(service.can('ws_free', 'webhooks')).resolves.toBe(true);
  });

  it('pro workspace unlocks pro capabilities', async () => {
    const service = createEntitlementsService({ loadPlan: planLoader({ ws_pro: 'pro' }) });
    await expect(service.can('ws_pro', 'removeBranding')).resolves.toBe(true);
    await expect(service.can('ws_pro', 'analytics')).resolves.toBe(true);
    await expect(service.can('ws_pro', 'customDomains')).resolves.toBe(true);
  });

  it('business workspace unlocks bigger quotas', async () => {
    const service = createEntitlementsService({ loadPlan: planLoader({ ws_biz: 'business' }) });
    const entitlements = await service.getEntitlements('ws_biz');
    expect(entitlements.fileUploadMaxMb).toBe(50);
    expect(entitlements.customDomains).toBe(5);
    expect(entitlements.seats).toBe(10);
  });

  it('numeric availability: customDomains 0 on free → false, 1 on pro → true', async () => {
    const service = createEntitlementsService({
      loadPlan: planLoader({ ws_free: 'free', ws_pro: 'pro' }),
    });
    await expect(service.can('ws_free', 'customDomains')).resolves.toBe(false);
    await expect(service.can('ws_pro', 'customDomains')).resolves.toBe(true);
  });

  it('unlimited capabilities available everywhere', async () => {
    const service = createEntitlementsService({ loadPlan: planLoader({ ws_free: 'free' }) });
    await expect(service.can('ws_free', 'documents')).resolves.toBe(true);
    await expect(service.can('ws_free', 'submissionsPerMonth')).resolves.toBe(true);
    await expect(service.can('ws_free', 'seats')).resolves.toBe(true);
    await expect(service.can('ws_free', 'fileUploadMaxMb')).resolves.toBe(true);
  });
});

describe('can() — workspace plan overrides', () => {
  it('unknown workspace falls back to free (fail closed for paid features)', async () => {
    const service = createEntitlementsService({ loadPlan: planLoader({}) });
    await expect(service.can('ws_ghost', 'removeBranding')).resolves.toBe(false);
    await expect(service.effectivePlan('ws_ghost')).resolves.toBe('free');
  });

  it('entitlementOverrides grant individual capabilities on top of the plan', async () => {
    const service = createEntitlementsService({
      loadPlan: planLoader({ ws_free: 'free' }),
      entitlementOverrides: (workspaceId) =>
        workspaceId === 'ws_free' ? { analytics: true, customDomains: 2 } : undefined,
    });
    await expect(service.can('ws_free', 'analytics')).resolves.toBe(true);
    const entitlements = await service.getEntitlements('ws_free');
    expect(entitlements.analytics).toBe(true);
    expect(entitlements.customDomains).toBe(2);
    // untouched rows keep the plan values
    expect(entitlements.seats).toBe(1);
    expect(entitlements.removeBranding).toBe(false);
  });

  it('overrides do not leak to other workspaces', async () => {
    const service = createEntitlementsService({
      loadPlan: planLoader({ ws_free: 'free', ws_other: 'free' }),
      entitlementOverrides: (workspaceId) =>
        workspaceId === 'ws_free' ? { analytics: true } : undefined,
    });
    await expect(service.can('ws_other', 'analytics')).resolves.toBe(false);
  });

  it('effectivePlan reports the loaded plan', async () => {
    const service = createEntitlementsService({ loadPlan: planLoader({ ws_pro: 'pro' }) });
    await expect(service.effectivePlan('ws_pro')).resolves.toBe('pro');
  });
});

describe('can() — entitlements cache (unlock within 30s + explicit invalidation)', () => {
  it('caches the plan within the TTL (one load for many calls)', async () => {
    const loadPlan = planLoader({ ws_pro: 'pro' });
    const service = createEntitlementsService({ loadPlan, nowMs: fakeNow(), cacheTtlMs: 15_000 });
    await service.can('ws_pro', 'removeBranding');
    await service.can('ws_pro', 'analytics');
    await service.can('ws_pro', 'seats');
    expect(loadPlan.calls).toEqual(['ws_pro']);
  });

  it('reloads after the TTL expires', async () => {
    let clock = 1_700_000_000_000;
    const loadPlan = planLoader({ ws_pro: 'pro' });
    const service = createEntitlementsService({
      loadPlan,
      nowMs: () => clock,
      cacheTtlMs: 15_000,
    });
    await service.can('ws_pro', 'removeBranding');
    clock += 16_000;
    await service.can('ws_pro', 'removeBranding');
    expect(loadPlan.calls).toEqual(['ws_pro', 'ws_pro']);
  });

  it('invalidateEntitlementsCache(workspaceId) forces a reload — webhook path', async () => {
    const loadPlan = planLoader({ ws_free: 'free' });
    const service = createEntitlementsService({ loadPlan, nowMs: fakeNow() });
    await expect(service.can('ws_free', 'removeBranding')).resolves.toBe(false);
    service.invalidateEntitlementsCache('ws_free');
    await expect(service.can('ws_free', 'removeBranding')).resolves.toBe(false);
    expect(loadPlan.calls).toEqual(['ws_free', 'ws_free']);
  });

  it('invalidateEntitlementsCache() clears everything', async () => {
    const loadPlan = planLoader({ ws_a: 'free', ws_b: 'free' });
    const service = createEntitlementsService({ loadPlan, nowMs: fakeNow() });
    await service.can('ws_a', 'analytics');
    await service.can('ws_b', 'analytics');
    service.invalidateEntitlementsCache();
    await service.can('ws_a', 'analytics');
    await service.can('ws_b', 'analytics');
    expect(loadPlan.calls).toHaveLength(4);
  });

  it('is a plain (workspaceId, capability) => Promise<boolean> callable', async () => {
    const service = createEntitlementsService({ loadPlan: async () => 'free' });
    const can = service.can;
    await expect(can('ws', 'webhooks')).resolves.toBe(true);
    expect(typeof can).toBe('function');
  });

  it('propagates store failures (programmer/infra errors throw, never silently deny)', async () => {
    const service = createEntitlementsService({
      loadPlan: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(service.can('ws', 'analytics')).rejects.toThrow('db down');
  });
});
