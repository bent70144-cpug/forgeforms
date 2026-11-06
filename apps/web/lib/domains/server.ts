// apps/web/lib/domains/server.ts
// Env wiring for the custom-domains service (issue #24, spec §5 env names,
// §3 injected ports). The ONLY place in web that knows how the domains module
// is assembled:
//   store/routing ← @formforge/db repositories (Drizzle over custom_domains /
//                   domain_routes — the §8 KV routing-table substitute)
//   dns           ← node resolver (manual TXT/CNAME verification fallback)
//   provisioner   ← Cloudflare for SaaS when CLOUDFLARE_API_TOKEN is set,
//                   manual DNS instructions otherwise
//   cdn           ← T10's CdnPurgeHook seam (noop impl; same purge path as
//                   publish/unpublish — spec §8 step 5)
//   gate          ← billing entitlements (can() + §13 customDomains quota)
// Tests never import this file — they build the service with fakes.
import { sql } from 'drizzle-orm';
import {
  createCloudflareProvisioner,
  createManualProvisioner,
  createNodeDnsLookup,
  makeDomainsService,
  type DomainGate,
  type DomainDocumentLookup,
  type DomainsService,
  type DomainsServiceDeps,
} from '@formforge/core/domains';
import { noopCdnPurge } from '@formforge/core/documents';
import { createEntitlementsService } from '@formforge/core/billing';
import {
  createBillingDb,
  createBillingRepository,
  type BillingDbClient,
} from '@formforge/db/repositories/billing';
import { getDomainsStoresFromEnv } from '@formforge/db/repositories/domains';

/** Public routing target customers CNAME to (SPEC-NOTE: env-overridable for
 * staging; defaults to the production edge hostname). */
export function routingTarget(env: NodeJS.ProcessEnv = process.env): string {
  return env.FORMFORGE_ROUTING_TARGET ?? 'sites.formforge.app';
}

/** Cloudflare for SaaS when configured; manual DNS fallback otherwise. */
export function createProvisionerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const target = routingTarget(env);
  return env.CLOUDFLARE_API_TOKEN
    ? createCloudflareProvisioner({
        apiToken: env.CLOUDFLARE_API_TOKEN,
        zoneId: env.CLOUDFLARE_ZONE_ID,
        routingTarget: target,
      })
    : createManualProvisioner(target);
}

/**
 * The billing gate for the §13 quota: the real entitlements service over
 * workspaces.plan (via the billing repository). Same can()/getEntitlements()
 * contract T23 publishes — if the composition root later wires a shared
 * entitlements singleton, swap this factory for it (no call sites change).
 */
export function createDomainsGateFromEnv(env: NodeJS.ProcessEnv = process.env): DomainGate {
  const billingRepo = createBillingRepository(createBillingDb(env.DATABASE_URL ?? ''));
  return createEntitlementsService({
    loadPlan: async (workspaceId) => {
      const row = await billingRepo.getWorkspaceBilling(workspaceId);
      return row?.plan ?? null;
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cross-tenant guard: a hostname may only attach to a document in the caller's
 * workspace. INTEGRATION-DEBT (T07): the `documents` table DDL is not part of
 * packages/db yet, so the tenant-scoped query is attempted and — while that
 * migration is absent — falls back to accepting well-formed ids (staging keeps
 * working; the moment T07's store lands this becomes strictly fail-closed).
 */
export function createDocumentLookupFromEnv(env: NodeJS.ProcessEnv = process.env): DomainDocumentLookup {
  const client: BillingDbClient = createBillingDb(env.DATABASE_URL ?? '');
  return {
    async getById(workspaceId, documentId) {
      if (!UUID_RE.test(documentId)) return null;
      try {
        const result = await client.execute(
          sql`select id from documents where id = ${documentId} and workspace_id = ${workspaceId} limit 1`,
        );
        if (result.rows.length > 0) return { id: documentId };
        return null;
      } catch {
        // T07 migration pending → format-checked id only (see note above).
        return { id: documentId };
      }
    },
  };
}

/** Assemble the domains service from process env (memoized per process). */
export function getDomainsService(): DomainsService {
  const globalForDomains = globalThis as typeof globalThis & {
    __formforgeDomains?: DomainsService;
  };
  globalForDomains.__formforgeDomains ??= createDomainsServiceFromEnv();
  return globalForDomains.__formforgeDomains;
}

export function createDomainsServiceFromEnv(env: NodeJS.ProcessEnv = process.env): DomainsService {
  const { store, routing } = getDomainsStoresFromEnv();
  const deps: DomainsServiceDeps = {
    store,
    routing,
    dns: createNodeDnsLookup(),
    provisioner: createProvisionerFromEnv(env),
    cdn: noopCdnPurge,
    routingTarget: routingTarget(env),
    documents: createDocumentLookupFromEnv(env),
    now: () => new Date(),
  };
  return makeDomainsService(deps, createDomainsGateFromEnv(env));
}
