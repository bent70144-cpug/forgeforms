/**
 * T24 — domain model for the custom-domains module (issue #24).
 *
 * State machine (ticket): `pending → verified`. ONLY `verified` rows may enter
 * the routing table (Host → documentId, spec §10.1); `pending` rows never route.
 * There is no `failed` state — a failed verification check keeps the row
 * `pending` and records the last error (the user just retries).
 */

export type CustomDomainStatus = 'pending' | 'verified';

/** How the hostname was provisioned: manual DNS fallback or Cloudflare for SaaS. */
export type ProvisionMode = 'manual' | 'cloudflare';

/** The DNS check that satisfied verification (manual fallback paths). */
export type VerificationMethod = 'txt' | 'cname';

/**
 * `custom_domains` row (spec §6 conventions: camelCase fields ↔ snake_case
 * columns; ids UUIDv7 app-generated; times via ctx.now()).
 */
export type CustomDomainRecord = {
  id: string;
  workspaceId: string;
  /** Normalized (lowercase, no scheme/port/trailing dot) — globally unique. */
  hostname: string;
  /** The published document this hostname serves (§10.1: Host → documentId). */
  documentId: string;
  status: CustomDomainStatus;
  /** Secret token the customer publishes as TXT to prove ownership. */
  verificationToken: string;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  /** Human-readable failure of the last verification attempt (null when none). */
  lastError: string | null;
  provisionMode: ProvisionMode;
  /** Cloudflare for SaaS custom-hostname id when provisioned via the API. */
  customHostnameId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** One DNS record the customer must create (settings UI renders these). */
export type DnsRecordInstruction = {
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
  purpose: string;
};

export type DnsInstructions = {
  mode: ProvisionMode;
  records: readonly DnsRecordInstruction[];
};

/** Outcome of adding a domain: the record + the records the user must publish. */
export type AddDomainOutcome = {
  domain: CustomDomainRecord;
  instructions: DnsInstructions;
};

export type VerifyOutcome = {
  domain: CustomDomainRecord;
  verified: boolean;
  method: VerificationMethod | null;
};

export type RemoveOutcome = {
  domainId: string;
  hostname: string;
  documentId: string;
  /** False when the domain was never routed (pending). */
  routingRemoved: boolean;
};
