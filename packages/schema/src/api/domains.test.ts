// Tests for the custom-domains API schemas + their OpenAPI registration (issue #24).
import { describe, expect, it } from 'vitest';
import {
  buildFormForgeOpenApi,
  CreateDomainRequestSchema,
  CreateDomainResponseSchema,
  CustomDomainSchema,
  HostnameSchema,
  ListDomainsResponseSchema,
  VerifyDomainResponseSchema,
} from './index';

const DOMAIN = {
  id: '018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f70',
  hostname: 'docs.example.com',
  documentId: '018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f71',
  status: 'pending',
  verificationToken: 'ab'.repeat(16),
  txtName: '_formforge-verify.docs.example.com',
  txtValue: `ff-domain-verification=${'ab'.repeat(16)}`,
  cnameTarget: 'sites.formforge.app',
  lastCheckedAt: null,
  verifiedAt: null,
  lastError: null,
  provisionMode: 'manual',
  createdAt: '2026-11-06T12:00:00.000Z',
};

describe('domain request schemas (issue #24)', () => {
  it('CreateDomainRequest accepts a hostname + document uuid', () => {
    expect(
      CreateDomainRequestSchema.parse({ hostname: ' docs.example.com ', documentId: DOMAIN.documentId }),
    ).toEqual({ hostname: 'docs.example.com', documentId: DOMAIN.documentId });
    expect(
      CreateDomainRequestSchema.safeParse({ hostname: 'not a domain!', documentId: DOMAIN.documentId }).success,
    ).toBe(false);
    expect(
      CreateDomainRequestSchema.safeParse({ hostname: 'docs.example.com', documentId: 'nope' }).success,
    ).toBe(false);
  });

  it('HostnameSchema rejects obviously-bad input (server does the authoritative checks)', () => {
    expect(HostnameSchema.safeParse('-bad.example.com').success).toBe(false);
    expect(HostnameSchema.safeParse('a'.repeat(300)).success).toBe(false);
    expect(HostnameSchema.safeParse('docs.example.com').success).toBe(true);
  });
});

describe('domain response schemas (issue #24)', () => {
  it('CustomDomain exposes the verification state (visible in settings)', () => {
    const parsed = CustomDomainSchema.parse(DOMAIN);
    expect(parsed.status).toBe('pending');
    expect(parsed.txtValue).toBe(`ff-domain-verification=${'ab'.repeat(16)}`);
    // verified variant
    expect(
      CustomDomainSchema.safeParse({ ...DOMAIN, status: 'verified', verifiedAt: '2026-11-06T12:05:00.000Z' }).success,
    ).toBe(true);
    // unknown status rejected
    expect(CustomDomainSchema.safeParse({ ...DOMAIN, status: 'failed' }).success).toBe(false);
  });

  it('verification token must be exactly 32 hex chars', () => {
    expect(CustomDomainSchema.safeParse({ ...DOMAIN, verificationToken: 'short' }).success).toBe(false);
    expect(CustomDomainSchema.safeParse({ ...DOMAIN, verificationToken: 'z'.repeat(32) }).success).toBe(false);
  });

  it('list envelope is §4-shaped with a null cursor (quota ≤ 5, no pagination)', () => {
    const parsed = ListDomainsResponseSchema.parse({ data: [DOMAIN], nextCursor: null });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.nextCursor).toBeNull();
  });

  it('verify response carries verified + method (txt | cname | null)', () => {
    expect(
      VerifyDomainResponseSchema.parse({ domain: DOMAIN, verified: true, method: 'txt' }).verified,
    ).toBe(true);
    expect(VerifyDomainResponseSchema.safeParse({ domain: DOMAIN, verified: false, method: 'carrier-pigeon' }).success).toBe(false);
    expect(VerifyDomainResponseSchema.safeParse({ domain: DOMAIN, verified: false, method: null }).success).toBe(true);
  });

  it('create response embeds DNS instructions for the manual fallback', () => {
    const parsed = CreateDomainResponseSchema.parse({
      domain: DOMAIN,
      instructions: {
        mode: 'manual',
        records: [
          { type: 'TXT', name: DOMAIN.txtName, value: DOMAIN.txtValue, purpose: 'Proves you control the hostname' },
          { type: 'CNAME', name: DOMAIN.hostname, value: DOMAIN.cnameTarget, purpose: 'Routes traffic to FormForge' },
        ],
      },
    });
    expect(parsed.instructions.records).toHaveLength(2);
    expect(parsed.instructions.mode).toBe('manual');
  });
});

describe('domains in the OpenAPI document', () => {
  const doc = buildFormForgeOpenApi({ serverUrl: 'https://forgeforms.test' });

  it('registers the /api/v1/domains surface', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/v1/domains', '/api/v1/domains/{id}/verify']),
    );
    expect(doc.paths['/api/v1/domains']!.post!['x-required-scope']).toBe('docs:write');
    expect(doc.paths['/api/v1/domains']!.post!.responses['402']).toBeTruthy(); // PLAN_LIMIT
    expect(doc.paths['/api/v1/domains/{id}/verify']!.post!.responses['200']).toBeTruthy();
  });

  it('registers the domain component schemas', () => {
    for (const name of ['CustomDomain', 'CreateDomainRequest', 'CreateDomainResponse', 'ListDomainsResponse', 'VerifyDomainResponse']) {
      expect(name in doc.components.schemas, name).toBe(true);
    }
  });
});
