// packages/core/src/billing/entitlements.ts
// THE entitlements matrix (spec §13) — pure data, one file, no IO.
// This is the only place in the codebase where plan → capability values live.
// Everything else must go through `can()` / `getEntitlements()` (spec §4:
// "one function only … no inline plan checks anywhere else").

import { AppError } from "../shared/errors.ts";
import { PLANS, type Plan } from './plans';

/** Fair-use soft alert (spec §13): no automatic cutoff, admin review. */
export const FAIR_USE_SUBMISSIONS_PER_MONTH = 100_000;

export type EntitlementValue = boolean | number | 'unlimited';

/** Entitlement row per plan. Numeric values are QUOTAS (max allowed);
 * booleans are feature toggles; 'unlimited' means no cap. */
export type Entitlements = {
  /** Number of documents (forms/pages/portfolios) the workspace may hold. */
  documents: number | 'unlimited';
  /** Completed submissions per calendar month. Unlimited on every plan
   * (spec §13) — gated only by the fair-use policy above. */
  submissionsPerMonth: number | 'unlimited';
  /** Max size in MB of a single uploaded file. */
  fileUploadMaxMb: number;
  /** Render public documents without the FormForge badge. */
  removeBranding: boolean;
  /** Max custom domains attached to the workspace. */
  customDomains: number;
  /** Max team members (owner included). */
  seats: number;
  /** Advanced analytics incl. drop-off questions (spec §13 row
   * "Advanced analytics (drop-off)"). */
  analytics: boolean;
  /** Keep in-progress submissions before completion. */
  partialSubmissions: boolean;
  /** Outbound webhooks on submission.completed. */
  webhooks: boolean;
  /** External REST API via api_tokens (spec §6). */
  apiAccess: boolean;
  /** AI-generated draft documents (Phase M8). */
  aiDrafts: boolean;
};

/** Capability names — THE strings other tickets pass to `can()`.
 * ⚠ Integrator contract: see report on issue #23. */
export const CAPABILITIES = [
  'documents',
  'submissionsPerMonth',
  'fileUploadMaxMb',
  'removeBranding',
  'customDomains',
  'seats',
  'analytics',
  'partialSubmissions',
  'webhooks',
  'apiAccess',
  'aiDrafts',
] as const satisfies readonly (keyof Entitlements)[];

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/**
 * The matrix — one row per spec §13 line, one column per plan.
 * SPEC-NOTE: `apiAccess` and `aiDrafts` are required by the issue #23 body
 * but have no §13 row; paid plans only (free keeps branding + no API/AI),
 * chosen conservatively — revisit with product before GA.
 */
export const ENTITLEMENTS: Record<Plan, Entitlements> = {
  free: {
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
  },
  pro: {
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
  },
  business: {
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
  },
};

/** Does `value` satisfy the need? With no explicit `need`, numeric quotas
 * only need to be > 0 (availability) — `can()` semantics. With a `need`
 * (e.g. "I need 2 custom domains", "upload is 8 MB"), the quota must cover it. */
export function entitlementSatisfies(value: EntitlementValue, need?: number): boolean {
  if (value === 'unlimited') return true;
  if (typeof value === 'boolean') return value;
  return need === undefined ? value > 0 : value >= need;
}

/** Cheapest plan whose matrix row satisfies the capability (and optional
 * numeric need). Null → no plan satisfies it (402 body carries `requiredPlan:
 * null` and the UI explains). Used to build PLAN_LIMIT error payloads. */
export function requiredPlanFor(capability: Capability, need?: number): Plan | null {
  for (const plan of PLANS) {
    if (entitlementSatisfies(ENTITLEMENTS[plan][capability], need)) return plan;
  }
  return null;
}

/** The one PLAN_LIMIT error factory — `HTTP 402 {capability, requiredPlan}`
 * (spec §13, issue #23). Callers must surface the upgrade prompt ONLY in
 * settings or on the error response, never inside editing surfaces. */
export function planLimitError(capability: Capability, need?: number): AppError {
  const requiredPlan = requiredPlanFor(capability, need);
  const message =
    requiredPlan === null
      ? `Capability "${capability}" is not available on any plan.`
      : `Plan limit reached for "${capability}" — upgrade to ${requiredPlan}.`;
  return new AppError('PLAN_LIMIT', message, [
    { path: 'capability', message: capability },
    ...(requiredPlan === null ? [] : [{ path: 'requiredPlan', message: requiredPlan }]),
    ...(need == null ? [] : [{ path: 'need', message: String(need) }]),
  ]);
}
