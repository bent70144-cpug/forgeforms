// §24 builder entitlements surface (builder-audit follow-up #8) — service-level
// tests for the composition in lib/api/entitlements.ts. No DB / no Stripe:
// the live resolver must degrade gracefully to the FREE-plan entitlements
// (fail closed for paid features), and the plan projection must pass billing's
// matrix values through verbatim (never re-derived inline).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENTITLEMENTS } from '@formforge/core/billing';
import {
  builderEntitlementsFor,
  builderEntitlementsForPlan,
  configureBuilderEntitlements,
  freeBuilderEntitlements,
  resolveBuilderEntitlements,
} from './entitlements';

// Hermetic: some dev sandboxes export DATABASE_URL globally — every live
// resolver test stubs it explicitly. getBilling is mocked at module level so
// the failure-path test below exercises the catch → free default branch
// without touching real infrastructure (the fast-path test returns before
// getBilling is ever called).
vi.mock('../../app/api/webhooks/stripe/_lib/billing-server', () => ({
  getBilling: () => {
    throw new Error('billing unavailable');
  },
}));

afterEach(() => {
  configureBuilderEntitlements(null);
  vi.unstubAllEnvs();
});

describe('builderEntitlementsForPlan (§24 projection)', () => {
  it('projects the billing matrix row verbatim for every plan', () => {
    for (const plan of ['free', 'pro', 'business'] as const) {
      expect(builderEntitlementsForPlan(plan, ENTITLEMENTS[plan])).toEqual({
        plan,
        removeBranding: ENTITLEMENTS[plan].removeBranding,
        fileUploadMaxMb: ENTITLEMENTS[plan].fileUploadMaxMb,
        customRedirect: ENTITLEMENTS[plan].customRedirect,
        notifyEmailsLimit: ENTITLEMENTS[plan].notifyEmailsLimit,
      });
    }
  });

  it('free: branding off, 1 notification recipient, no redirect endings, 10 MB uploads', () => {
    expect(freeBuilderEntitlements()).toEqual({
      plan: 'free',
      removeBranding: false,
      fileUploadMaxMb: 10,
      customRedirect: false,
      notifyEmailsLimit: 1,
    });
  });
});

describe('resolveBuilderEntitlements (graceful path)', () => {
  it('defaults to the free-plan entitlements when no DATABASE_URL is configured', async () => {
    // Vitest runs without DATABASE_URL (dev/test in-memory mode) — the
    // billing store cannot answer; the resolver must NOT throw (the builder
    // bootstrap never 500s on billing infrastructure).
    vi.stubEnv('DATABASE_URL', ''); // hermetic fast-path: skip billing entirely
    await expect(resolveBuilderEntitlements('ws_1')).resolves.toEqual(freeBuilderEntitlements());
  });

  it('defaults to the free-plan entitlements when the billing service fails', async () => {
    // DATABASE_URL set but billing itself is down (mocked getBilling throws)
    // — the catch branch degrades to free instead of failing the bootstrap.
    vi.stubEnv('DATABASE_URL', 'file::memory:');
    await expect(resolveBuilderEntitlements('ws_1')).resolves.toEqual(freeBuilderEntitlements());
  });
});

describe('builderEntitlementsFor (override-aware entry point)', () => {
  it('uses the configured resolver (route tests / integrator seam)', async () => {
    configureBuilderEntitlements(async (workspaceId) => {
      expect(workspaceId).toBe('ws_pro');
      return {
        plan: 'pro',
        removeBranding: true,
        fileUploadMaxMb: 10,
        customRedirect: true,
        notifyEmailsLimit: 10,
      };
    });
    await expect(builderEntitlementsFor('ws_pro')).resolves.toEqual({
      plan: 'pro',
      removeBranding: true,
      fileUploadMaxMb: 10,
      customRedirect: true,
      notifyEmailsLimit: 10,
    });
  });

  it('falls back to the live resolver when the override is cleared', async () => {
    configureBuilderEntitlements(null);
    await expect(builderEntitlementsFor('ws_1')).resolves.toEqual(freeBuilderEntitlements());
  });
});
