/**
 * T24 — ports (dependency seams) for the domains module.
 *
 * Core defines the contracts; `packages/db/src/repositories/domains.ts` supplies
 * the Drizzle implementations and the app composition root (apps/web) wires them.
 * DNS and Cloudflare for SaaS are behind interfaces so unit tests stay DB-free
 * and network-free (ticket: "mock DNS lookups behind an interface").
 */
import type { Capability, Entitlements } from '../billing/index.ts';
import type { CdnPurgeHook } from '../documents/index.ts';
import type {
  AddDomainOutcome,
  CustomDomainRecord,
  DnsInstructions,
  ProvisionMode,
  RemoveOutcome,
  VerificationMethod,
} from './model.ts';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface DomainsStore {
  insert(record: CustomDomainRecord): Promise<CustomDomainRecord>;
  listByWorkspace(workspaceId: string): Promise<CustomDomainRecord[]>;
  /** Tenant-scoped fetch — null when the row lives in another workspace. */
  getById(workspaceId: string, id: string): Promise<CustomDomainRecord | null>;
  /** Global lookup (hostnames are globally unique) — conflict checks. */
  getByHostname(hostname: string): Promise<CustomDomainRecord | null>;
  setVerificationState(
    workspaceId: string,
    id: string,
    patch: Pick<CustomDomainRecord, 'status' | 'lastCheckedAt' | 'verifiedAt' | 'lastError'>,
  ): Promise<CustomDomainRecord>;
  /** Tenant-scoped delete. False when nothing matched. */
  delete(workspaceId: string, id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Routing table (spec §8 publish step: "update KV routing entry"; §10.1:
// "Middleware maps Host → documentId via routing table")
// ---------------------------------------------------------------------------

/**
 * Host → documentId mapping. Implementations: Drizzle-backed table now,
 * Cloudflare KV (or the workers KV binding) at the composition root later.
 * INVARIANT: entries exist ONLY for verified domains — the service is the
 * single writer and writes only after a successful verification.
 */
export interface DomainsRoutingTable {
  /** Register/refresh the Host → documentId entry (verified hostnames only). */
  put(hostname: string, documentId: string, workspaceId: string): Promise<void>;
  remove(hostname: string): Promise<void>;
  /** Returns the documentId for a verified hostname, null when unrouted. */
  get(hostname: string): Promise<string | null>;
  /** Hostnames currently routed to a document (removal/cache tooling). */
  listByDocument(documentId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// DNS + provisioning seams
// ---------------------------------------------------------------------------

/** DNS resolver seam — the manual verification fallback reads TXT/CNAME through it. */
export interface DnsLookup {
  /** All TXT string values for `name` (empty when NXDOMAIN/NODATA). */
  txt(name: string): Promise<string[]>;
  /** The CNAME chain target for `name`, null when none. */
  cname(name: string): Promise<string | null>;
}

export type ProvisionOutcome = {
  mode: ProvisionMode;
  /** Cloudflare for SaaS custom-hostname id (null in manual mode). */
  customHostnameId: string | null;
  instructions: DnsInstructions;
};

/**
 * Provisioning seam. When CLOUDFLARE_API_TOKEN is configured the composition
 * root supplies the Cloudflare-for-SaaS implementation (creates a custom
 * hostname + pre-validation record); otherwise the manual fallback returns the
 * DNS instructions for the TXT/CNAME flow.
 */
export interface DomainProvisioner {
  provision(input: { hostname: string; verificationToken: string }): Promise<ProvisionOutcome>;
  /** Best-effort cleanup on removal (never blocks the delete path). */
  deprovision(hostname: string): Promise<void>;
}

/**
 * Minimal document lookup used to reject attaching a hostname to a document
 * outside the caller's workspace (cross-tenant routing guard). Structurally
 * satisfied by the documents module' DocumentsRepo.getById.
 */
export interface DomainDocumentLookup {
  getById(
    workspaceId: string,
    documentId: string,
  ): Promise<Readonly<{ id: string }> | null>;
}

// ---------------------------------------------------------------------------
// Billing gate (spec §4: feature gating = can(); §13 row "Custom domain")
// ---------------------------------------------------------------------------

/** Structural subset of the billing entitlements service (spec §4). */
export interface DomainGate {
  can(workspaceId: string, capability: Capability): Promise<boolean>;
  getEntitlements(workspaceId: string): Promise<Entitlements>;
}

// ---------------------------------------------------------------------------
// Service deps + outcomes
// ---------------------------------------------------------------------------

/** Everything the domains service needs, injected (spec §3). */
export type DomainsServiceDeps = {
  store: DomainsStore;
  routing: DomainsRoutingTable;
  dns: DnsLookup;
  provisioner: DomainProvisioner;
  /** The SAME cache-purge path T10's publish/unpublish uses (spec §8 step 5). */
  cdn: CdnPurgeHook;
  /** Public hostname traffic CNAMEs to (e.g. "sites.formforge.app"). */
  routingTarget: string;
  documents: DomainDocumentLookup;
  /** Injected clock (spec §4: never `new Date()` inside services). */
  now: () => Date;
};

export type AddDomainResult = AddDomainOutcome;
export type RemoveDomainResult = RemoveOutcome;
export type VerifyDomainResult = {
  domain: CustomDomainRecord;
  verified: boolean;
  method: VerificationMethod | null;
};
