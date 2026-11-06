// Drizzle repository for custom domains (issue #24, spec §6 conventions).
//
// Implements the core `DomainsStore` and `DomainsRoutingTable` ports from
// @formforge/core/domains so the domains service stays storage-agnostic
// (spec §3: repositories live in packages/db; only the owning module's
// composition root wires them).
//
// INTEGRATION-DEBT (T02): tenant scoping via RLS (`set local
// app.workspace_id = …`, spec §6) goes through T02's transaction helper; the
// explicit `workspaceId = eq(...)` predicates below already scope every
// workspace-owned read/write.

import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type {
  CustomDomainRecord,
  DomainDocumentLookup,
  DomainsRoutingTable,
  DomainsStore,
} from '@formforge/core/domains';
import { customDomains, domainRoutes } from '../schema/domains.ts';
import type { DomainRoute } from '../schema/domains.ts';
import { createBillingDb, type BillingDbClient } from './billing.ts';

/** Minimal structural type — any Drizzle pg database satisfies it. */
export type DomainsDb = Pick<
  NodePgDatabase<Record<string, never>>,
  'select' | 'insert' | 'update' | 'delete'
>;

type DomainRow = typeof customDomains.$inferSelect;

function mapRow(row: DomainRow): CustomDomainRecord {
  const status = row.status === 'verified' ? 'verified' : 'pending';
  const provisionMode = row.provisionMode === 'cloudflare' ? 'cloudflare' : 'manual';
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    hostname: row.hostname,
    documentId: row.documentId,
    status,
    verificationToken: row.verificationToken,
    lastCheckedAt: row.lastCheckedAt ?? null,
    verifiedAt: row.verifiedAt ?? null,
    lastError: row.lastError ?? null,
    provisionMode,
    customHostnameId: row.customHostnameId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDomainsStore(db: DomainsDb): DomainsStore {
  return {
    async insert(record) {
      const [row] = await db
        .insert(customDomains)
        .values({
          id: record.id,
          workspaceId: record.workspaceId,
          hostname: record.hostname,
          documentId: record.documentId,
          status: record.status,
          verificationToken: record.verificationToken,
          lastCheckedAt: record.lastCheckedAt,
          verifiedAt: record.verifiedAt,
          lastError: record.lastError,
          provisionMode: record.provisionMode,
          customHostnameId: record.customHostnameId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        })
        .returning();
      if (!row) throw new Error('custom_domains insert returned no row');
      return mapRow(row);
    },

    async listByWorkspace(workspaceId) {
      const rows = await db
        .select()
        .from(customDomains)
        .where(eq(customDomains.workspaceId, workspaceId))
        .orderBy(asc(customDomains.createdAt));
      return rows.map(mapRow);
    },

    async getById(workspaceId, id) {
      const [row] = await db
        .select()
        .from(customDomains)
        .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, workspaceId)))
        .limit(1);
      return row ? mapRow(row) : null;
    },

    async getByHostname(hostname) {
      const [row] = await db
        .select()
        .from(customDomains)
        .where(eq(customDomains.hostname, hostname))
        .limit(1);
      return row ? mapRow(row) : null;
    },

    async setVerificationState(workspaceId, id, patch) {
      const [row] = await db
        .update(customDomains)
        .set({
          status: patch.status,
          lastCheckedAt: patch.lastCheckedAt,
          verifiedAt: patch.verifiedAt,
          lastError: patch.lastError,
          updatedAt: new Date(),
        })
        .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, workspaceId)))
        .returning();
      if (!row) throw new Error(`custom_domains update returned no row for ${id}`);
      return mapRow(row);
    },

    async delete(workspaceId, id) {
      const rows = await db
        .delete(customDomains)
        .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, workspaceId)))
        .returning({ id: customDomains.id });
      return rows.length > 0;
    },
  };
}

/**
 * The §8 KV routing entry over Postgres (the KV substitute until Cloudflare KV
 * lands at the composition root). INVARIANT mirrored from the service: rows
 * exist only for verified hostnames — writes happen exclusively through the
 * domains service after verification succeeds.
 */
export function createDomainsRoutingTable(db: DomainsDb): DomainsRoutingTable {
  return {
    async put(hostname, documentId, workspaceId) {
      await db
        .insert(domainRoutes)
        .values({ hostname, documentId, workspaceId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: domainRoutes.hostname,
          set: { documentId, workspaceId, updatedAt: new Date() },
        });
    },

    async remove(hostname) {
      await db.delete(domainRoutes).where(eq(domainRoutes.hostname, hostname));
    },

    async get(hostname) {
      const [row] = await db
        .select()
        .from(domainRoutes)
        .where(eq(domainRoutes.hostname, hostname))
        .limit(1);
      return row ? row.documentId : null;
    },

    async listByDocument(documentId) {
      const rows = await db
        .select()
        .from(domainRoutes)
        .where(eq(domainRoutes.documentId, documentId));
      return rows.map((row: DomainRoute) => row.hostname);
    },
  };
}

let cached: { store: DomainsStore; routing: DomainsRoutingTable } | null = null;

/**
 * Cross-tenant guard for attaching hostnames (issue #24): a hostname may only
 * route to a document in the caller's workspace, so `addDomain` resolves the
 * document through this workspace-scoped lookup.
 *
 * INTEGRATION (T24×T07 merge): T07's documents table/repos are merged (schema
 * src/schema/documents.ts, migration 0002) — the lookup now hits the real
 * store and FAILS CLOSED: null when the document does not exist in the
 * workspace (the addDomain service maps that to NOT_FOUND). Query failures
 * propagate (no silent format-only acceptance).
 */
export function createDomainsDocumentLookup(db: BillingDbClient): DomainDocumentLookup {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    async getById(workspaceId, documentId) {
      if (!UUID_RE.test(documentId)) return null;
      const result = await db.execute(
        sql`select id from documents where id = ${documentId} and workspace_id = ${workspaceId} limit 1`,
      );
      return result.rows.length > 0 ? { id: documentId } : null;
    },
  };
}

/** Env-backed lookup factory (mirrors getDomainsStoresFromEnv). */
export function createDomainsDocumentLookupFromEnv(): DomainDocumentLookup {
  return createDomainsDocumentLookup(createBillingDb());
}

/**
 * INTEGRATION-DEBT: awaiting T02 — convenience factory for call sites without
 * T02's shared db client (mirrors repositories/api-tokens.ts getApiTokenStoreFromEnv).
 * Reads DATABASE_URL, keeps one lazy module-level pool.
 */
export function getDomainsStoresFromEnv(): { store: DomainsStore; routing: DomainsRoutingTable } {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — cannot build the domains stores');
  }
  const pool = new Pool({ connectionString, max: 5 });
  const db = drizzle(pool) as unknown as NodePgDatabase<Record<string, never>>;
  cached = {
    store: createDomainsStore(db),
    routing: createDomainsRoutingTable(db),
  };
  return cached;
}
