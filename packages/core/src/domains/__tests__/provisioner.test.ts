/**
 * T24 — middleware seam tests for the Host → documentId routing (spec §10.1)
 * and the Cloudflare for SaaS provisioner behind its interface (CLOUDFLARE_API_TOKEN).
 */
import { describe, expect, it } from 'vitest';
import { createCloudflareProvisioner } from '../provisioner.ts';
import { isAppHost, normalizeRequestHost, resolveHostDocumentId } from '../routing.ts';
import { InMemoryRoutingTable } from './helpers.ts';

describe('middleware host resolution (§10.1)', () => {
  const table = new InMemoryRoutingTable();
  table.entries.set('docs.example.com', 'doc_1');
  table.entries.set('www.other.example', 'doc_2');

  it('resolves a routed Host header (with port + case noise) to the documentId', async () => {
    await expect(resolveHostDocumentId(table, 'Docs.Example.com:8443')).resolves.toBe('doc_1');
    await expect(resolveHostDocumentId(table, 'WWW.other.EXAMPLE.')).resolves.toBe('doc_2');
  });

  it('returns null for unknown hosts, unrouted hosts and empty input', async () => {
    await expect(resolveHostDocumentId(table, 'unknown.example.com')).resolves.toBeNull();
    await expect(resolveHostDocumentId(table, '')).resolves.toBeNull();
  });

  it('isAppHost guards the deployment hosts so middleware never rewrites them', () => {
    expect(isAppHost('localhost:3000', ['localhost', 'formforge.app'])).toBe(true);
    expect(isAppHost('formforge.app', ['localhost', 'formforge.app'])).toBe(true);
    expect(isAppHost('docs.example.com', ['localhost', 'formforge.app'])).toBe(false);
  });

  it('normalizeRequestHost strips the port but keeps apex markers out', () => {
    expect(normalizeRequestHost('127.0.0.1:3000')).toBe('127.0.0.1');
  });
});

describe('Cloudflare for SaaS provisioner (behind CLOUDFLARE_API_TOKEN)', () => {
  const fetchJson = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('creates a custom hostname and returns its id + verification instructions', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return fetchJson({
        success: true,
        errors: [],
        result: {
          id: 'cf_ch_123',
          hostname: 'docs.example.com',
          status: 'pending',
          ownership_verification: {
            type: 'txt',
            name: '_cf-custom-hostname.docs.example.com',
            value: 'confirm-token-value',
          },
        },
      });
    }) as typeof fetch;

    const provisioner = createCloudflareProvisioner({
      apiToken: 'cf-token',
      zoneId: 'zone_1',
      routingTarget: 'sites.formforge.test',
      fetchImpl,
    });
    const outcome = await provisioner.provision({ hostname: 'docs.example.com', verificationToken: 'a'.repeat(32) });

    expect(outcome.mode).toBe('cloudflare');
    expect(outcome.customHostnameId).toBe('cf_ch_123');
    expect(outcome.instructions.records[0]?.type).toBe('TXT');
    expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/zones/zone_1/custom_hostnames');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer cf-token');
  });

  it('surfaces Cloudflare API failures as an INTERNAL AppError (add path → 500)', async () => {
    const fetchImpl = (async () =>
      fetchJson({ success: false, errors: [{ code: 1000, message: 'hostname not allowed' }], result: null })) as typeof fetch;
    const provisioner = createCloudflareProvisioner({
      apiToken: 'cf-token',
      routingTarget: 'sites.formforge.test',
      fetchImpl,
    });
    await expect(provisioner.provision({ hostname: 'x.example.com', verificationToken: 't' })).rejects.toMatchObject({
      name: 'AppError',
      code: 'INTERNAL',
    });
  });

  it('deprovision is best-effort: swallows API errors (removal must never block)', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const provisioner = createCloudflareProvisioner({
      apiToken: 'cf-token',
      routingTarget: 'sites.formforge.test',
      fetchImpl,
    });
    await expect(provisioner.deprovision('docs.example.com')).resolves.toBeUndefined();
  });
});
