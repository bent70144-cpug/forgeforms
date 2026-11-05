// tests: entitlements matrix — every capability × every plan (spec §13).
import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ENTITLEMENTS,
  FAIR_USE_SUBMISSIONS_PER_MONTH,
  entitlementSatisfies,
  isCapability,
  planLimitError,
  requiredPlanFor,
} from './entitlements';
import { PLANS } from './plans';
import { AppError } from '../bridge';

describe('ENTITLEMENTS matrix (spec §13)', () => {
  it('has exactly the §13 rows, free column', () => {
    expect(ENTITLEMENTS.free).toEqual({
      documents: 'unlimited',
      submissionsPerMonth: 'unlimited',
      fileUploadMaxMb: 10,
      removeBranding: false,
      customDomains: 0,
      seats: 1,
      analytics: false,
      partialSubmissions: false,
      webhooks: true,
      apiAccess: false,
      aiDrafts: false,
    });
  });

  it('has exactly the §13 rows, pro column', () => {
    expect(ENTITLEMENTS.pro).toEqual({
      documents: 'unlimited',
      submissionsPerMonth: 'unlimited',
      fileUploadMaxMb: 10,
      removeBranding: true,
      customDomains: 1,
      seats: 3,
      analytics: true,
      partialSubmissions: true,
      webhooks: true,
      apiAccess: true,
      aiDrafts: true,
    });
  });

  it('has exactly the §13 rows, business column', () => {
    expect(ENTITLEMENTS.business).toEqual({
      documents: 'unlimited',
      submissionsPerMonth: 'unlimited',
      fileUploadMaxMb: 50,
      removeBranding: true,
      customDomains: 5,
      seats: 10,
      analytics: true,
      partialSubmissions: true,
      webhooks: true,
      apiAccess: true,
      aiDrafts: true,
    });
  });

  it('every capability is present on every plan (no holes)', () => {
    for (const plan of PLANS) {
      for (const capability of CAPABILITIES) {
        expect(ENTITLEMENTS[plan][capability], `${plan}.${capability}`).toBeDefined();
      }
    }
  });

  it('seat limits are 1/3/10 per §13', () => {
    expect(ENTITLEMENTS.free.seats).toBe(1);
    expect(ENTITLEMENTS.pro.seats).toBe(3);
    expect(ENTITLEMENTS.business.seats).toBe(10);
  });

  it('fair use is a soft alert at 100k submissions/month, no cutoff', () => {
    expect(FAIR_USE_SUBMISSIONS_PER_MONTH).toBe(100_000);
    expect(ENTITLEMENTS.free.submissionsPerMonth).toBe('unlimited');
  });
});

describe('entitlementSatisfies', () => {
  it('unlimited always satisfies, even with a need', () => {
    expect(entitlementSatisfies('unlimited')).toBe(true);
    expect(entitlementSatisfies('unlimited', 10_000_000)).toBe(true);
  });

  it('booleans satisfy by truthiness regardless of need', () => {
    expect(entitlementSatisfies(true)).toBe(true);
    expect(entitlementSatisfies(true, 5)).toBe(true);
    expect(entitlementSatisfies(false)).toBe(false);
  });

  it('numbers: availability is > 0; with a need the quota must cover it', () => {
    expect(entitlementSatisfies(0)).toBe(false);
    expect(entitlementSatisfies(1)).toBe(true);
    expect(entitlementSatisfies(1, 1)).toBe(true);
    expect(entitlementSatisfies(1, 2)).toBe(false);
    expect(entitlementSatisfies(50, 50)).toBe(true);
  });
});

describe('requiredPlanFor (402 payload {capability, requiredPlan})', () => {
  it('removeBranding unlocks at pro', () => {
    expect(requiredPlanFor('removeBranding')).toBe('pro');
  });

  it('analytics and partialSubmissions unlock at pro', () => {
    expect(requiredPlanFor('analytics')).toBe('pro');
    expect(requiredPlanFor('partialSubmissions')).toBe('pro');
  });

  it('apiAccess and aiDrafts unlock at pro', () => {
    expect(requiredPlanFor('apiAccess')).toBe('pro');
    expect(requiredPlanFor('aiDrafts')).toBe('pro');
  });

  it('customDomains: 1 → pro, 2..5 → business, 6 → no plan', () => {
    expect(requiredPlanFor('customDomains')).toBe('pro'); // availability
    expect(requiredPlanFor('customDomains', 1)).toBe('pro');
    expect(requiredPlanFor('customDomains', 2)).toBe('business');
    expect(requiredPlanFor('customDomains', 5)).toBe('business');
    expect(requiredPlanFor('customDomains', 6)).toBeNull();
  });

  it('seats: 2 → pro, 10 → business, 11 → no plan', () => {
    expect(requiredPlanFor('seats', 2)).toBe('pro');
    expect(requiredPlanFor('seats', 10)).toBe('business');
    expect(requiredPlanFor('seats', 11)).toBeNull();
  });

  it('fileUploadMaxMb: 10 → free, 50 → business, 51 → no plan', () => {
    expect(requiredPlanFor('fileUploadMaxMb', 10)).toBe('free');
    expect(requiredPlanFor('fileUploadMaxMb', 11)).toBe('business');
    expect(requiredPlanFor('fileUploadMaxMb', 50)).toBe('business');
    expect(requiredPlanFor('fileUploadMaxMb', 51)).toBeNull();
  });

  it('unlimited capabilities satisfy any need from free', () => {
    expect(requiredPlanFor('documents', 1_000_000)).toBe('free');
    expect(requiredPlanFor('submissionsPerMonth', FAIR_USE_SUBMISSIONS_PER_MONTH + 1)).toBe('free');
  });

  it('webhooks are available on free', () => {
    expect(requiredPlanFor('webhooks')).toBe('free');
  });
});

describe('planLimitError', () => {
  it('carries capability + requiredPlan for the 402 body', () => {
    const error = planLimitError('customDomains', 2);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('PLAN_LIMIT');
    expect(error.details).toEqual([
      { path: 'capability', message: 'customDomains' },
      { path: 'requiredPlan', message: 'business' },
      { path: 'need', message: '2' },
    ]);
    expect(error.message).toContain('business');
  });

  it('requiredPlan null when no plan can satisfy the need', () => {
    const error = planLimitError('seats', 11);
    expect(error.code).toBe('PLAN_LIMIT');
    expect(error.details).toEqual([
      { path: 'capability', message: 'seats' },
      { path: 'need', message: '11' },
    ]);
  });
});

describe('isCapability', () => {
  it('accepts exactly the CAPABILITIES names', () => {
    expect(isCapability('seats')).toBe(true);
    expect(isCapability('fileUploadMaxMb')).toBe(true);
    expect(isCapability('seat')).toBe(false);
    expect(isCapability('plan')).toBe(false);
  });
});
