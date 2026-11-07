/**
 * Builder entitlements surface (§24 — builder-audit follow-up #8).
 *
 * THE composition point that turns the billing module's entitlement row
 * (`getEntitlements()` over the workspace's effective plan) into the
 * §24 builder gate values carried on the GET /documents/{id} envelope.
 * Per spec §4 the values ALWAYS come from billing — this module never reads
 * `workspaces.plan` itself and never hardcodes plan limits.
 *
 * Graceful degradation (no Stripe / no DB): when billing cannot be resolved
 * (DATABASE_URL unset, store failure, Stripe unconfigured), the workspace
 * defaults to the FREE-plan entitlements — fail closed for paid features,
 * the builder keeps working. Tests swap the resolver via
 * `configureBuilderEntitlements` (same pattern as configureCrudDocuments).
 */
import {
  ENTITLEMENTS,
  type Entitlements as PlanEntitlements,
  type Plan,
} from '@formforge/core/billing';
import { getBilling } from '../../app/api/webhooks/stripe/_lib/billing-server';

/** Wire shape (§11 envelope `entitlements` — BuilderEntitlementsSchema). */
export type BuilderEntitlements = {
  plan: Plan;
  removeBranding: boolean;
  fileUploadMaxMb: number;
  customRedirect: boolean;
  notifyEmailsLimit: number;
};

/** Project a billing entitlements row onto the §24 builder surface. */
export function builderEntitlementsForPlan(
  plan: Plan,
  row: PlanEntitlements,
): BuilderEntitlements {
  return {
    plan,
    removeBranding: row.removeBranding,
    fileUploadMaxMb: row.fileUploadMaxMb,
    customRedirect: row.customRedirect,
    notifyEmailsLimit: row.notifyEmailsLimit,
  };
}

/** Free-plan entitlements — the deterministic default when billing is
 * unreachable (unknown workspace / no subscription / no DB). */
export function freeBuilderEntitlements(): BuilderEntitlements {
  return builderEntitlementsForPlan('free', ENTITLEMENTS.free);
}

/**
 * Live resolver: ask the billing service (its own plan cache + overrides).
 * Any failure → free entitlements, so the builder bootstrap never 500s on
 * billing infrastructure (§24 graceful path).
 */
export async function resolveBuilderEntitlements(
  workspaceId: string,
): Promise<BuilderEntitlements> {
  // No DB configured (dev/test in-memory mode) — the billing store cannot
  // answer; skip straight to the free default instead of opening a pool.
  if (!process.env['DATABASE_URL']) return freeBuilderEntitlements();
  try {
    const billing = getBilling();
    const row = await billing.getEntitlements(workspaceId);
    const plan = await billing.effectivePlan(workspaceId);
    return builderEntitlementsForPlan(plan, row);
  } catch {
    return freeBuilderEntitlements();
  }
}

// --- test/bootstrap seam (mirrors configureCrudDocuments) -------------------

type Resolver = (workspaceId: string) => Promise<BuilderEntitlements>;

let resolverOverride: Resolver | null = null;

/** Swap the entitlements resolver (tests); pass null to restore the live one. */
export function configureBuilderEntitlements(next: Resolver | null): void {
  resolverOverride = next;
}

/** The GET route's entry point — override-aware. */
export async function builderEntitlementsFor(
  workspaceId: string,
): Promise<BuilderEntitlements> {
  if (resolverOverride) return resolverOverride(workspaceId);
  return resolveBuilderEntitlements(workspaceId);
}
