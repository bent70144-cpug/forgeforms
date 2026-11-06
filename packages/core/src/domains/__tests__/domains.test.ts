/**
 * T24 — domains service tests (issue #24, spec §13 custom-domain row, §14 settings,
 * §2 middleware host routing, §8 publish-step routing table).
 *
 * Acceptance under test:
 *  1. Custom hostname → verified → enters the routing table (Host → documentId).
 *  2. Unverified domains are NEVER routed; verification state is visible.
 *  3. Domain limit enforced by can() with PLAN_LIMIT (402) on excess (0 / 1 / 5 per §13).
 *  4. Removing a domain updates the routing table + purges cache (T10's CdnPurgeHook path).
 * All DNS lookups are mocked behind the DnsLookup port (sandbox has no live DNS/DB).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from "../../shared/errors.ts";;
import {
  dnsPassingCname,
  dnsPassingTxt,
  fakeGate,
  makeCtx,
  makeDomainsHarness,
  PLAN_DOMAIN_LIMITS,
  ROUTING_TARGET,
  seedPendingDomain,
  verificationTxtName,
  verificationTxtValue,
} from './helpers.ts';
import { makeDomainsService } from '../service.ts';
import { hostRouteKey, normalizeRequestHost } from '../routing.ts';
import { normalizeHostname } from '../hostname.ts';

describe('addDomain — validation and conflict handling', () => {
  it('creates a pending domain with a verification token and manual DNS instructions', async () => {
    const harness = makeDomainsHarness();
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.addDomain(makeCtx(), {
      hostname: 'Docs.Example.com.',
      documentId: 'doc_1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.hostname).toBe('docs.example.com'); // normalized
    expect(result.value.domain.status).toBe('pending'); // state machine: pending → verified
    expect(result.value.domain.verificationToken).toMatch(/^[0-9a-f]{32}$/);
    expect(result.value.domain.provisionMode).toBe('manual');
    // DNS instructions from the spec manual fallback: TXT verification + CNAME target
    const records = result.value.instructions.records;
    expect(
      records.some(
        (r) =>
          r.type === 'TXT' &&
          r.name === verificationTxtName('docs.example.com') &&
          r.value === verificationTxtValue(result.value.domain.verificationToken),
      ),
    ).toBe(true);
    expect(
      records.some(
        (r) => r.type === 'CNAME' && r.value === ROUTING_TARGET,
      ),
    ).toBe(true);
    // Not routed before verification.
    await expect(harness.routing.get('docs.example.com')).resolves.toBeNull();
  });

  it('rejects malformed hostnames with VALIDATION', async () => {
    const harness = makeDomainsHarness();
    const service = makeDomainsService(harness.deps, harness.gate);
    for (const bad of [
      'not a domain',
      '-bad.example.com',
      'docs..example.com',
      'docs.example.c',
      'do_cs.example.com',
      '',
    ]) {
      const result = await service.addDomain(makeCtx(), { hostname: bad, documentId: 'doc_1' });
      expect(result.ok, bad).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION');
        expect(result.error.details.some((d) => d.path === 'hostname')).toBe(true);
      }
    }
  });

  it('accepts a pasted URL and stores the bare hostname (settings UX)', async () => {
    const harness = makeDomainsHarness();
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.addDomain(makeCtx(), {
      hostname: 'https://docs.example.com/x',
      documentId: 'doc_1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.hostname).toBe('docs.example.com');
  });

  it('rejects unknown documents in the workspace with NOT_FOUND (no cross-tenant routing)', async () => {
    const harness = makeDomainsHarness();
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.addDomain(makeCtx(), { hostname: 'docs.example.com', documentId: 'doc_other' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('rejects a hostname another workspace already attached with CONFLICT', async () => {
    const harness = makeDomainsHarness();
    seedPendingDomain(harness, { workspaceId: 'ws_b', hostname: 'taken.example.com' });
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.addDomain(makeCtx(), { hostname: 'taken.example.com', documentId: 'doc_1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT');
  });
});

describe('addDomain — plan limit enforced by can() with 402 on excess (spec §13: no | 1 | 5)', () => {
  it('free workspace: can() false → PLAN_LIMIT before anything is persisted', async () => {
    const harness = makeDomainsHarness({ plans: { ws_free: 'free' } });
    const gate = fakeGate({ ws_free: 'free' });
    const service = makeDomainsService(harness.deps, gate);
    const result = await service.addDomain(makeCtx({ workspaceId: 'ws_free' }), {
      hostname: 'docs.example.com',
      documentId: 'doc_f1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLAN_LIMIT');
      expect(result.error.status).toBe(402);
      expect(result.error.details).toContainEqual({ path: 'capability', message: 'customDomains' });
    }
    expect(gate.calls).toContain('ws_free:customDomains');
    expect(harness.store.rows.size).toBe(0); // nothing written
    expect(harness.provisioner.provisioned).toEqual([]);
  });

  it('pro workspace (limit 1): first domain ok, second → PLAN_LIMIT requiring business', async () => {
    const harness = makeDomainsHarness({ plans: { ws_pro: 'pro' } });
    const service = makeDomainsService(harness.deps, harness.gate);
    const ctx = makeCtx({ workspaceId: 'ws_pro' });

    const first = await service.addDomain(ctx, { hostname: 'one.example.com', documentId: 'doc_1' });
    expect(first.ok).toBe(true);

    const second = await service.addDomain(ctx, { hostname: 'two.example.com', documentId: 'doc_1' });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('PLAN_LIMIT');
      expect(second.error.status).toBe(402);
      const need = second.error.details.find((d) => d.path === 'need');
      expect(need?.message).toBe('2');
      const requiredPlan = second.error.details.find((d) => d.path === 'requiredPlan');
      expect(requiredPlan?.message).toBe('business'); // 2 domains ⇒ §13 business row
    }
  });

  it('business workspace (limit 5): five domains ok, sixth → PLAN_LIMIT', async () => {
    const harness = makeDomainsHarness({ plans: { ws_biz: 'business' } });
    const service = makeDomainsService(harness.deps, harness.gate);
    const ctx = makeCtx({ workspaceId: 'ws_biz' });

    for (let i = 1; i <= PLAN_DOMAIN_LIMITS.business; i += 1) {
      const result = await service.addDomain(ctx, { hostname: `d${i}.example.com`, documentId: 'doc_b1' });
      expect(result.ok, `domain ${i}`).toBe(true);
    }
    const sixth = await service.addDomain(ctx, { hostname: 'd6.example.com', documentId: 'doc_b1' });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error.code).toBe('PLAN_LIMIT');
  });

  it('pending (unverified) domains count against the limit too', async () => {
    const harness = makeDomainsHarness({ plans: { ws_pro: 'pro' } });
    seedPendingDomain(harness, { workspaceId: 'ws_pro', hostname: 'pending.example.com', documentId: 'doc_1' });
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.addDomain(makeCtx({ workspaceId: 'ws_pro' }), {
      hostname: 'second.example.com',
      documentId: 'doc_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLAN_LIMIT');
  });
});

describe('verifyDomain — state machine pending → verified; only verified routes', () => {
  it('correct TXT token → verified + routing entry Host → documentId', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness);
    dnsPassingTxt(harness, domain.hostname, domain.verificationToken);
    const service = makeDomainsService(harness.deps, harness.gate);

    const result = await service.verifyDomain(makeCtx(), domain.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(true);
    expect(result.value.method).toBe('txt');
    expect(result.value.domain.status).toBe('verified');
    expect(result.value.domain.verifiedAt).toBeInstanceOf(Date);
    // §10.1: middleware maps Host → documentId via the routing table.
    await expect(harness.routing.get(domain.hostname)).resolves.toBe('doc_1');
  });

  it('TXT lookup asks exactly _formforge-verify.<hostname>', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness);
    const service = makeDomainsService(harness.deps, harness.gate);
    await service.verifyDomain(makeCtx(), domain.id);
    expect(harness.dns.txtQueries).toEqual([verificationTxtName(domain.hostname)]);
  });

  it('wrong/missing TXT → falls back to CNAME; matching target → verified via cname', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness);
    dnsPassingCname(harness, domain.hostname);
    const service = makeDomainsService(harness.deps, harness.gate);

    const result = await service.verifyDomain(makeCtx(), domain.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(true);
    expect(result.value.method).toBe('cname');
    await expect(harness.routing.get(domain.hostname)).resolves.toBe('doc_1');
  });

  it('failed verification stays pending, records the error, and NEVER routes', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness);
    const service = makeDomainsService(harness.deps, harness.gate);

    const result = await service.verifyDomain(makeCtx(), domain.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    expect(result.value.domain.status).toBe('pending');
    expect(result.value.domain.lastError).toBeTruthy();
    expect(result.value.domain.lastCheckedAt).toBeInstanceOf(Date);
    await expect(harness.routing.get(domain.hostname)).resolves.toBeNull(); // unverified ⇒ unrouted
  });

  it('a wrong TXT value (token mismatch) never verifies — defense against spoofing', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness);
    harness.dns.txtAnswers[verificationTxtName(domain.hostname)] = [
      verificationTxtValue('b'.repeat(32)), // someone else's token
    ];
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.verifyDomain(makeCtx(), domain.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(false);
    await expect(harness.routing.get(domain.hostname)).resolves.toBeNull();
  });

  it('re-verifying a verified domain is an idempotent no-op (still routed)', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness, { status: 'verified', verifiedAt: new Date() });
    await harness.routing.put(domain.hostname, domain.documentId);
    const service = makeDomainsService(harness.deps, harness.gate);

    const result = await service.verifyDomain(makeCtx(), domain.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verified).toBe(true);
    expect(harness.dns.txtQueries).toEqual([]); // no DNS re-check
    await expect(harness.routing.get(domain.hostname)).resolves.toBe('doc_1');
  });

  it('unknown id in another workspace → NOT_FOUND', async () => {
    const harness = makeDomainsHarness();
    seedPendingDomain(harness, { workspaceId: 'ws_b' });
    const service = makeDomainsService(harness.deps, harness.gate);
    const rows = [...harness.store.rows.values()];
    const result = await service.verifyDomain(makeCtx(), rows[0]!.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('removeDomain — updates routing table + purges cache (T10 purge path)', () => {
  it('removes the routing entry, deletes the row, purges host key + doc tag', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness, { status: 'verified', verifiedAt: new Date() });
    await harness.routing.put(domain.hostname, domain.documentId);
    const service = makeDomainsService(harness.deps, harness.gate);

    const result = await service.removeDomain(makeCtx(), domain.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routingRemoved).toBe(true);
    await expect(harness.routing.get(domain.hostname)).resolves.toBeNull();
    expect([...harness.store.rows.values()]).toHaveLength(0);
    // Same cache-purge seam T10 publish/unpublish uses:
    expect(harness.cdn.tags).toContain(`doc:${domain.documentId}`);
    expect(harness.cdn.keys).toContain(hostRouteKey(domain.hostname));
    expect(harness.provisioner.deprovisioned).toEqual([domain.hostname]);
  });

  it('removing a pending (never routed) domain still cleans up safely', async () => {
    const harness = makeDomainsHarness();
    const domain = seedPendingDomain(harness);
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.removeDomain(makeCtx(), domain.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routingRemoved).toBe(false);
    expect(harness.cdn.keys).toContain(hostRouteKey(domain.hostname));
  });

  it('unknown or foreign domain → NOT_FOUND, routing untouched', async () => {
    const harness = makeDomainsHarness();
    const foreign = seedPendingDomain(harness, {
      workspaceId: 'ws_b',
      hostname: 'foreign.example.com',
      documentId: 'doc_b1',
    });
    await harness.routing.put(foreign.hostname, foreign.documentId);
    const service = makeDomainsService(harness.deps, harness.gate);

    const result = await service.removeDomain(makeCtx(), foreign.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    await expect(harness.routing.get(foreign.hostname)).resolves.toBe('doc_b1');
  });
});

describe('listDomains / getDomain — verification state visible (settings surface)', () => {
  it('lists workspace domains with status + check info, nothing from other workspaces', async () => {
    const harness = makeDomainsHarness();
    seedPendingDomain(harness, { hostname: 'mine.example.com' });
    seedPendingDomain(harness, { workspaceId: 'ws_b', hostname: 'theirs.example.com' });
    const service = makeDomainsService(harness.deps, harness.gate);

    const list = await service.listDomains(makeCtx());
    expect(list.map((d) => d.hostname)).toEqual(['mine.example.com']);
    expect(list[0]).toHaveProperty('status', 'pending');
    expect(list[0]).toHaveProperty('verificationToken');
  });

  it('getDomain is tenant-scoped', async () => {
    const harness = makeDomainsHarness();
    const foreign = seedPendingDomain(harness, { workspaceId: 'ws_b' });
    const service = makeDomainsService(harness.deps, harness.gate);
    const result = await service.getDomain(makeCtx(), foreign.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('request-host normalization (middleware seam, §10.1)', () => {
  it('strips ports, trailing dots and upper case from a Host header', () => {
    expect(normalizeRequestHost('Docs.Example.com:443')).toBe('docs.example.com');
    expect(normalizeRequestHost('docs.example.com.')).toBe('docs.example.com');
    expect(normalizeRequestHost('DOCS.example.COM')).toBe('docs.example.com');
    expect(normalizeRequestHost('localhost:3000')).toBe('localhost');
  });

  it('normalizeHostname matches normalizeRequestHost for plain hosts', () => {
    expect(normalizeHostname('docs.example.com')).toBe('docs.example.com');
    expect(normalizeHostname('DOCS.Example.COM.')).toBe('docs.example.com');
  });

  it('verifies the routing key vocabulary is host-prefixed', () => {
    expect(hostRouteKey('docs.example.com')).toBe('host:docs.example.com');
  });
});

describe('AppError contract', () => {
  it('PLAN_LIMIT errors carry HTTP 402 (spec §4 mapping)', () => {
    expect(new AppError('PLAN_LIMIT', 'x').status).toBe(402);
    expect(new AppError('CONFLICT', 'x').status).toBe(409);
    expect(new AppError('VALIDATION', 'x').status).toBe(422);
    expect(new AppError('NOT_FOUND', 'x').status).toBe(404);
  });
});
