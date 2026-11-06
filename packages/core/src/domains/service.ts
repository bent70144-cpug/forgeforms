/**
 * T24 — domains service (issue #24, spec §13 custom-domain row, §14 settings,
 * §10.1 middleware routing, §8 publish-step routing table).
 *
 * Flow (manual fallback):
 *   add  → normalize+validate → conflict check → can() plan gate → provision
 *        → insert `pending` (NOT routed) → hand back DNS instructions;
 *   verify → TXT token match (fallback CNAME target) → `verified`
 *        → routing.put(hostname → documentId) — the ONLY routing writer;
 *   remove → routing.remove → store.delete → CDN purge (same seam as T10)
 *        → best-effort deprovision.
 *
 * Errors use the §4 kernel: VALIDATION (422), CONFLICT (409), NOT_FOUND (404),
 * PLAN_LIMIT (402) via billing.planLimitError — never inline plan checks.
 */
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { uuidv7 } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { planLimitError, type Capability } from '../billing/index.ts';
import { docTag } from '../documents/index.ts';
import {
  generateVerificationToken,
  normalizeHostname,
  parseVerificationValue,
  validateHostname,
  verificationTxtName,
} from './hostname.ts';
import type {
  AddDomainOutcome,
  CustomDomainRecord,
  RemoveOutcome,
  VerificationMethod,
  VerifyOutcome,
} from './model.ts';
import { hostRouteKey } from './routing.ts';
import type { DomainsServiceDeps, DomainGate } from './ports.ts';

/** The one capability row this module gates through billing (spec §13). */
export const CUSTOM_DOMAINS_CAPABILITY: Capability = 'customDomains';

export type AddDomainInput = {
  hostname: string;
  documentId: string;
};

export interface DomainsService {
  /** Add a hostname (pending). Enforces the §13 limit → PLAN_LIMIT 402. */
  addDomain(ctx: Ctx, input: AddDomainInput): Promise<Result<AddDomainOutcome, AppError>>;
  /** Workspace's domains with verification state (settings surface). */
  listDomains(ctx: Ctx): Promise<CustomDomainRecord[]>;
  /** Tenant-scoped single fetch. */
  getDomain(ctx: Ctx, domainId: string): Promise<Result<CustomDomainRecord, AppError>>;
  /** Re-check DNS; on success flips pending → verified and routes the host. */
  verifyDomain(ctx: Ctx, domainId: string): Promise<Result<VerifyOutcome, AppError>>;
  /** Remove + unroute + purge cache + best-effort deprovision. */
  removeDomain(ctx: Ctx, domainId: string): Promise<Result<RemoveOutcome, AppError>>;
}

export function makeDomainsService(
  deps: DomainsServiceDeps,
  gate: DomainGate,
): DomainsService {
  return {
    async addDomain(ctx, input): Promise<Result<AddDomainOutcome, AppError>> {
      // 1. Normalize + validate (§4 VALIDATION).
      const hostname = normalizeHostname(input.hostname);
      const issues = validateHostname(hostname);
      if (issues.length > 0) {
        return err(new AppError('VALIDATION', 'Invalid hostname', issues));
      }

      // 2. The document must exist in the caller's workspace — a hostname can
      //    never route to another tenant's document (cross-tenant guard).
      const doc = await deps.documents.getById(ctx.workspaceId, input.documentId);
      if (!doc) {
        return err(
          new AppError('NOT_FOUND', `Document ${input.documentId} not found`, [
            { path: 'documentId', message: 'unknown document in this workspace' },
          ]),
        );
      }

      // 3. Hostnames are globally unique (one routing entry per host).
      const existing = await deps.store.getByHostname(hostname);
      if (existing) {
        return err(new AppError('CONFLICT', `Hostname ${hostname} is already attached`, [
          { path: 'hostname', message: 'already in use' },
        ]));
      }

      // 4. Plan gate (spec §4: can() is the only gating function; §13 row
      //    "Custom domain": no | 1 | 5). can() covers the zero-quota case
      //    (free); the entitlement quota covers counting on paid plans.
      const allowed = await gate.can(ctx.workspaceId, CUSTOM_DOMAINS_CAPABILITY);
      if (!allowed) {
        return err(planLimitError(CUSTOM_DOMAINS_CAPABILITY, 1));
      }
      const entitlements = await gate.getEntitlements(ctx.workspaceId);
      const current = await deps.store.listByWorkspace(ctx.workspaceId);
      const need = current.length + 1;
      if (need > entitlements.customDomains) {
        return err(planLimitError(CUSTOM_DOMAINS_CAPABILITY, need));
      }

      // 5. Provision (Cloudflare for SaaS when configured, manual fallback
      //    otherwise) and persist as `pending` — routing happens on verify.
      const verificationToken = generateVerificationToken();
      const provisioned = await deps.provisioner.provision({ hostname, verificationToken });
      const record = await deps.store.insert({
        id: uuidv7(),
        workspaceId: ctx.workspaceId,
        hostname,
        documentId: input.documentId,
        status: 'pending',
        verificationToken,
        lastCheckedAt: null,
        verifiedAt: null,
        lastError: null,
        provisionMode: provisioned.mode,
        customHostnameId: provisioned.customHostnameId,
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      });

      return ok({ domain: record, instructions: provisioned.instructions });
    },

    async listDomains(ctx): Promise<CustomDomainRecord[]> {
      return deps.store.listByWorkspace(ctx.workspaceId);
    },

    async getDomain(ctx, domainId): Promise<Result<CustomDomainRecord, AppError>> {
      const record = await deps.store.getById(ctx.workspaceId, domainId);
      if (!record) {
        return err(AppError.notFound('Domain not found'));
      }
      return ok(record);
    },

    async verifyDomain(ctx, domainId): Promise<Result<VerifyOutcome, AppError>> {
      const record = await deps.store.getById(ctx.workspaceId, domainId);
      if (!record) {
        return err(AppError.notFound('Domain not found'));
      }

      // Idempotent: an already-verified domain stays verified (and routed).
      if (record.status === 'verified') {
        return ok({ domain: record, verified: true, method: null });
      }

      const method = await checkOwnership(deps, record);
      if (method !== null) {
        const verified = await deps.store.setVerificationState(ctx.workspaceId, domainId, {
          status: 'verified',
          lastCheckedAt: ctx.now(),
          verifiedAt: ctx.now(),
          lastError: null,
        });
        // The ONLY place a hostname enters the routing table (unverified never
        // routes — ticket state machine: pending → verified → routed).
        await deps.routing.put(record.hostname, record.documentId, ctx.workspaceId);
        return ok({ domain: verified, verified: true, method });
      }

      const failure = 'Ownership not proven yet: publish the TXT record (or CNAME) and retry.';
      const stillPending = await deps.store.setVerificationState(ctx.workspaceId, domainId, {
        status: 'pending',
        lastCheckedAt: ctx.now(),
        verifiedAt: null,
        lastError: failure,
      });
      return ok({ domain: stillPending, verified: false, method: null });
    },

    async removeDomain(ctx, domainId): Promise<Result<RemoveOutcome, AppError>> {
      const record = await deps.store.getById(ctx.workspaceId, domainId);
      if (!record) {
        return err(AppError.notFound('Domain not found'));
      }

      // 1. Drop the routing entry first — traffic stops before state changes.
      const wasRouted = record.status === 'verified';
      await deps.routing.remove(record.hostname);

      // 2. Delete the row (tenant-scoped).
      await deps.store.delete(ctx.workspaceId, domainId);

      // 3. Purge cache through the SAME seam T10 publish/unpublish uses
      //    (doc:<id> tag + exact keys, spec §8 step 5).
      await deps.cdn.purgeTag(docTag(record.documentId));
      await deps.cdn.purgeKeys([hostRouteKey(record.hostname)]);

      // 4. Best-effort edge cleanup (Cloudflare for SaaS custom hostname) —
      //    never blocks the removal path.
      await deps.provisioner.deprovision(record.hostname).catch(() => {});

      return ok({
        domainId: record.id,
        hostname: record.hostname,
        documentId: record.documentId,
        routingRemoved: wasRouted,
      });
    },
  };
}

/**
 * Ownership check for the manual DNS fallback (ticket: "TXT/CNAME verification
 * check behind the same interface"). TXT token match wins; otherwise a CNAME
 * pointing exactly at the routing target also proves routing intent.
 */
async function checkOwnership(
  deps: DomainsServiceDeps,
  record: CustomDomainRecord,
): Promise<VerificationMethod | null> {
  const txtName = verificationTxtName(record.hostname);
  const txtValues = await deps.dns.txt(txtName).catch(() => [] as string[]);
  for (const value of txtValues) {
    const token = parseVerificationValue(value);
    if (token !== null && timingSafeEqual(token, record.verificationToken)) {
      return 'txt';
    }
  }
  const cname = await deps.dns.cname(record.hostname).catch(() => null);
  if (cname !== null && normalizeHostname(cname) === normalizeHostname(deps.routingTarget)) {
    return 'cname';
  }
  return null;
}

/** Constant-time comparison — verification tokens are secrets in the DB. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type { DnsInstructions } from './model.ts';
export type { ProvisionOutcome } from './ports.ts';
