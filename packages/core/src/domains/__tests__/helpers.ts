/**
 * T24 — shared test fixtures for the domains module (mirrors documents/__tests__/helpers.ts).
 * Fakes for the store, routing table, DNS lookup, provisioner and CDN purge seams —
 * everything DB-free (sandbox: no live Postgres/Redis; DNS lookups are mocked behind the port).
 */
import { randomUUID } from 'node:crypto';
import { ENTITLEMENTS, type Entitlements } from '../../billing/index.ts';
import { type Ctx } from "../../shared/ctx.ts";
import { manualDnsInstructions, verificationTxtName, verificationTxtValue } from '../hostname.ts';
import type { CustomDomainRecord } from '../model.ts';
import type {
  DnsLookup,
  DomainGate,
  DomainProvisioner,
  DomainsRoutingTable,
  DomainsServiceDeps,
  DomainsStore,
  ProvisionOutcome,
} from '../ports.ts';

export function makeClock(start = Date.parse('2026-11-06T12:00:00.000Z')) {
  let current = start;
  return {
    now: () => new Date(current),
    tick: (ms = 1): void => {
      current += ms;
    },
  };
}

export function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  const clock = makeClock();
  return {
    workspaceId: 'ws_a',
    actor: { type: 'user', id: 'u_1' },
    requestId: 'req_test_1',
    now: clock.now,
    ...overrides,
  };
}

export const ROUTING_TARGET = 'sites.formforge.test';

/** In-memory DomainsStore fake (spec §6-style rows, no persistence). */
export class InMemoryDomainsStore implements DomainsStore {
  readonly rows = new Map<string, CustomDomainRecord>();

  async insert(input: CustomDomainRecord): Promise<CustomDomainRecord> {
    const record: CustomDomainRecord = { ...input };
    this.rows.set(record.id, record);
    return record;
  }

  async listByWorkspace(workspaceId: string): Promise<CustomDomainRecord[]> {
    return [...this.rows.values()].filter((r) => r.workspaceId === workspaceId);
  }

  async getById(workspaceId: string, id: string): Promise<CustomDomainRecord | null> {
    const row = this.rows.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async getByHostname(hostname: string): Promise<CustomDomainRecord | null> {
    return [...this.rows.values()].find((r) => r.hostname === hostname) ?? null;
  }

  async setVerificationState(
    workspaceId: string,
    id: string,
    patch: Pick<CustomDomainRecord, 'status' | 'lastCheckedAt' | 'verifiedAt' | 'lastError'>,
  ): Promise<CustomDomainRecord> {
    const row = await this.getById(workspaceId, id);
    if (!row) throw new Error(`domain ${id} not found in ${workspaceId}`);
    const next = { ...row, ...patch };
    this.rows.set(id, next);
    return next;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const row = await this.getById(workspaceId, id);
    if (!row) return false;
    this.rows.delete(id);
    return true;
  }
}

/** In-memory routing table fake — only verified entries are ever written by the service. */
export class InMemoryRoutingTable implements DomainsRoutingTable {
  readonly entries = new Map<string, string>();

  async put(hostname: string, documentId: string, workspaceId?: string): Promise<void> {
    void workspaceId;
    this.entries.set(hostname, documentId);
  }

  async remove(hostname: string): Promise<void> {
    this.entries.delete(hostname);
  }

  async get(hostname: string): Promise<string | null> {
    return this.entries.get(hostname) ?? null;
  }

  async listByDocument(documentId: string): Promise<string[]> {
    return [...this.entries.entries()].filter(([, doc]) => doc === documentId).map(([host]) => host);
  }
}

/** Fake DNS: TXT/CNAME answers come from maps (spec §5 manual fallback, mocked in tests). */
export class FakeDnsLookup implements DnsLookup {
  readonly txtQueries: string[] = [];
  readonly cnameQueries: string[] = [];
  readonly txtAnswers: Record<string, string[]>;
  readonly cnameAnswers: Record<string, string>;

  constructor(
    txtAnswers: Record<string, string[]> = {},
    cnameAnswers: Record<string, string> = {},
  ) {
    this.txtAnswers = { ...txtAnswers };
    this.cnameAnswers = { ...cnameAnswers };
  }

  async txt(name: string): Promise<string[]> {
    this.txtQueries.push(name);
    return this.txtAnswers[name] ?? [];
  }

  async cname(name: string): Promise<string | null> {
    this.cnameQueries.push(name);
    return this.cnameAnswers[name] ?? null;
  }
}

/** Fake provisioner: records calls, hands back manual DNS instructions. */
export class FakeProvisioner implements DomainProvisioner {
  readonly provisioned: string[] = [];
  readonly deprovisioned: string[] = [];

  async provision(input: { hostname: string; verificationToken: string }): Promise<ProvisionOutcome> {
    this.provisioned.push(input.hostname);
    return {
      mode: 'manual',
      customHostnameId: null,
      instructions: manualDnsInstructions(input.hostname, ROUTING_TARGET, input.verificationToken),
    };
  }

  async deprovision(hostname: string): Promise<void> {
    this.deprovisioned.push(hostname);
  }
}

/** Recording CDN purge fake — same shape as documents' CdnPurgeHook (T10 seam). */
export class RecordingCdnPurge {
  readonly tags: string[] = [];
  readonly keys: string[] = [];

  async purgeTag(tag: string): Promise<void> {
    this.tags.push(tag);
  }

  async purgeKeys(keys: readonly string[]): Promise<void> {
    this.keys.push(...keys);
  }
}

export type Plan = 'free' | 'pro' | 'business';
/** Spec §13 row "Custom domain": no | 1 | 5. */
export const PLAN_DOMAIN_LIMITS: Record<Plan, number> = { free: 0, pro: 1, business: 5 };

/** Fake can()/getEntitlements() gate with the §13 customDomains row (0 / 1 / 5). */
export function fakeGate(plans: Record<string, Plan>): DomainGate & { calls: string[] } {
  const calls: string[] = [];
  const entitlementsFor = (workspaceId: string): Entitlements => ({
    ...ENTITLEMENTS.free,
    customDomains: PLAN_DOMAIN_LIMITS[plans[workspaceId] ?? 'free'],
  });
  return {
    calls,
    async can(workspaceId, capability) {
      calls.push(`${workspaceId}:${capability}`);
      return PLAN_DOMAIN_LIMITS[plans[workspaceId] ?? 'free'] > 0;
    },
    async getEntitlements(workspaceId) {
      calls.push(`${workspaceId}:entitlements`);
      return entitlementsFor(workspaceId);
    },
  };
}

export type DomainsHarness = {
  store: InMemoryDomainsStore;
  routing: InMemoryRoutingTable;
  dns: FakeDnsLookup;
  provisioner: FakeProvisioner;
  cdn: RecordingCdnPurge;
  gate: ReturnType<typeof fakeGate>;
  deps: DomainsServiceDeps;
};

export function makeDomainsHarness(overrides: {
  plans?: Record<string, Plan>;
  dns?: FakeDnsLookup;
  /** workspaceId → the one document id it owns. */
  documentIds?: Record<string, string>;
} = {}): DomainsHarness {
  const store = new InMemoryDomainsStore();
  const routing = new InMemoryRoutingTable();
  const dns = overrides.dns ?? new FakeDnsLookup();
  const provisioner = new FakeProvisioner();
  const cdn = new RecordingCdnPurge();
  const gate = fakeGate(overrides.plans ?? { ws_a: 'pro', ws_b: 'free', ws_biz: 'business' });
  const clock = makeClock();
  const documentIds = new Map<string, string>(
    Object.entries(
      overrides.documentIds ?? {
        ws_a: 'doc_1',
        ws_b: 'doc_b1',
        ws_pro: 'doc_1',
        ws_biz: 'doc_b1',
        ws_free: 'doc_f1',
      },
    ),
  );
  const deps: DomainsServiceDeps = {
    store,
    routing,
    dns,
    provisioner,
    cdn,
    routingTarget: ROUTING_TARGET,
    documents: {
      async getById(workspaceId, documentId) {
        return documentIds.get(workspaceId) === documentId ? { id: documentId } : null;
      },
    },
    now: clock.now,
  };
  return { store, routing, dns, provisioner, cdn, gate, deps };
}

/** Convenience: seed one pending domain row the way the service would have created it. */
export function seedPendingDomain(
  harness: DomainsHarness,
  overrides: Partial<CustomDomainRecord> = {},
): CustomDomainRecord {
  const token = 'a'.repeat(32);
  const now = new Date('2026-11-06T11:00:00.000Z');
  const record: CustomDomainRecord = {
    id: overrides.id ?? randomUUID(),
    workspaceId: 'ws_a',
    hostname: 'docs.example.com',
    documentId: 'doc_1',
    status: 'pending',
    verificationToken: token,
    lastCheckedAt: null,
    verifiedAt: null,
    lastError: null,
    provisionMode: 'manual',
    customHostnameId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  harness.store.rows.set(record.id, record);
  return record;
}

/** Pre-configure the fake DNS so `hostname` passes TXT verification. */
export function dnsPassingTxt(harness: DomainsHarness, hostname: string, token: string): void {
  harness.dns.txtAnswers[verificationTxtName(hostname)] = [verificationTxtValue(token)];
}

/** Pre-configure the fake DNS so `hostname` passes the CNAME fallback. */
export function dnsPassingCname(harness: DomainsHarness, hostname: string): void {
  harness.dns.cnameAnswers[hostname] = ROUTING_TARGET;
}

export { manualDnsInstructions, verificationTxtName, verificationTxtValue };
