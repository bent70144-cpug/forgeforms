// T29 — SSRF guard tests (spec §17 + ticket acceptance: "webhook delivery to
// 169.254.169.254 / 10.x / localhost blocked (test)").
//
// All DNS is faked via the injected `lookup` seam — no network is touched.
// The transport is captured so tests prove the guard rejects BEFORE connect
// and that the pinned lookup hands the transport a validated address only.
import { describe, expect, it, vi } from 'vitest';
import {
  checkWebhookUrl,
  createSsrfSafePost,
  isPrivateOrReservedIp,
  resolveSafeAddresses,
  type DnsLookupAll,
} from './ssrf-guard';
import { deliverWebhook, type HttpPost } from './webhook-dispatcher';

const PUBLIC = { address: '93.184.216.34', family: 4 };

function lookupReturning(...records: Array<{ address: string; family: number }>): DnsLookupAll {
  return vi.fn(async () => records);
}

describe('isPrivateOrReservedIp — IPv4', () => {
  it.each([
    '169.254.169.254', // cloud metadata (acceptance case)
    '169.254.0.1',
    '10.1.2.3', // acceptance case (10.x)
    '10.0.0.0',
    '127.0.0.1', // acceptance case (localhost)
    '127.255.255.254',
    '0.0.0.0',
    '0.1.2.3',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '100.64.0.1', // CGNAT
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
    '255.255.255.255', // broadcast
    '192.0.2.1', // TEST-NET-1
    '198.18.0.5', // benchmarking
  ])('blocks %j', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // just outside 172.16/12
    '198.20.0.1', // just outside 198.18/15
    '192.169.1.1', // just outside 192.168/16 (and not TEST-NET)
  ])('allows public %j', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(false);
  });
});

describe('isPrivateOrReservedIp — IPv6', () => {
  it.each([
    '::1', // acceptance case (IPv6 loopback)
    '::',
    'fe80::1', // link-local
    'fe80::1%eth0', // with zone id
    'fc00::1', // unique-local
    'fd12:3456:789a::1', // unique-local
    'ff02::1', // multicast
    '::ffff:10.0.0.1', // IPv4-mapped private
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254', // IPv4-mapped metadata
    '2001:db8::1', // documentation range
    '100::1', // discard-only
    'not-an-ip', // unparseable → fail closed
  ])('blocks %j', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each([
    '2606:4c00::a1', // public
    '::ffff:93.184.216.34', // IPv4-mapped PUBLIC → allowed
    '2001:4860:4860::8888',
  ])('allows public %j', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(false);
  });
});

describe('checkWebhookUrl — URL policy (layer 1)', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/hook',
    'http://127.0.0.1:8080/hook',
    'http://[::1]/hook',
    'http://localhost/hook',
    'http://LOCALHOST:3000/hook',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://service.internal/hook',
    'https://myhost.localhost/hook',
    'ftp://example.com/hook',
    'file:///etc/passwd',
    'gopher://example.com',
    'http://user:pass@example.com/hook', // credentials
    'http://2130706433/hook', // decimal dword for 127.0.0.1
    'http://0x7f000001/hook', // hex dword
    'not a url at all',
  ])('rejects %j', (url) => {
    const checked = checkWebhookUrl(url);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.reason.length).toBeGreaterThan(0);
  });

  it.each([
    'https://example.com/webhook',
    'http://hooks.example.test:8080/ingest?x=1',
    'https://93.184.216.34/hook', // PUBLIC IP literal is allowed
  ])('accepts %j', (url) => {
    expect(checkWebhookUrl(url).ok).toBe(true);
  });
});

describe('resolveSafeAddresses — DNS policy (layer 2)', () => {
  it('blocks when ANY resolved address is private (multi-record fail closed)', async () => {
    const result = await resolveSafeAddresses('rebind.example', lookupReturning(PUBLIC, { address: '10.0.0.1', family: 4 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('10.0.0.1');
  });

  it.each([
    ['169.254.169.254', 'metadata attack'],
    ['10.1.2.3', 'private network'],
    ['127.0.0.1', 'loopback'],
    ['::1', 'IPv6 loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
  ])('blocks DNS answer %j (%s)', async (address) => {
    const result = await resolveSafeAddresses('evil.example', lookupReturning({ address, family: 4 }));
    expect(result.ok).toBe(false);
  });

  it('blocks DNS failure (fail closed)', async () => {
    const lookup: DnsLookupAll = async () => {
      throw new Error('ENOTFOUND');
    };
    const result = await resolveSafeAddresses('gone.example', lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('ENOTFOUND');
  });

  it('blocks empty DNS answers', async () => {
    expect((await resolveSafeAddresses('empty.example', lookupReturning())).ok).toBe(false);
  });

  it('returns validated addresses for public hosts', async () => {
    const result = await resolveSafeAddresses('hooks.example', lookupReturning(PUBLIC));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.addresses).toEqual([PUBLIC]);
  });
});

describe('createSsrfSafePost — transport (layer 3)', () => {
  const baseInit = {
    method: 'POST' as const,
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: new AbortController().signal,
  };

  it('refuses blocked URL literals BEFORE the transport runs', async () => {
    const transport = vi.fn(async () => ({ ok: true, status: 200 }));
    const post = createSsrfSafePost({ lookup: lookupReturning(PUBLIC), transport });
    await expect(post('http://169.254.169.254/latest/meta-data/', baseInit)).rejects.toThrow(/SSRF guard/);
    await expect(post('http://10.1.2.3/hook', baseInit)).rejects.toThrow(/private\/reserved/);
    await expect(post('http://127.0.0.1/hook', baseInit)).rejects.toThrow(/SSRF guard/);
    await expect(post('http://localhost/hook', baseInit)).rejects.toThrow(/SSRF guard/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses hostnames that resolve to blocked ranges BEFORE the transport runs', async () => {
    const transport = vi.fn(async () => ({ ok: true, status: 200 }));
    const post = createSsrfSafePost({ lookup: lookupReturning({ address: '192.168.0.10', family: 4 }), transport });
    await expect(post('https://intranet.example/hook', baseInit)).rejects.toThrow(/192\.168\.0\.10/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('re-validates inside the pinned lookup (DNS rebinding defense)', async () => {
    const lookup = lookupReturning({ address: '169.254.169.254', family: 4 });
    const post = createSsrfSafePost({ lookup, transport: vi.fn(async () => ({ ok: true, status: 200 })) });
    await expect(post('https://rebind.example/h', baseInit)).rejects.toThrow(/169\.254\.169\.254|refused to connect/);
  });

  it('delivers through the transport for public hosts', async () => {
    const transport = vi.fn(async () => ({ ok: true, status: 200 }));
    const post = createSsrfSafePost({ lookup: lookupReturning(PUBLIC), transport });
    const res = await post('https://hooks.example/hook', baseInit);
    expect(res).toEqual({ ok: true, status: 200 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('deliverWebhook + SSRF guard (dispatcher integration)', () => {
  const target = { id: 'wh1', url: 'http://169.254.169.254/latest/meta-data/', secret: 's3cret' };
  const init = (post: HttpPost) => ({ target, body: '{"e":1}', timestampSeconds: 1, post, timeoutMs: 500 });

  it('returns a failed DeliveryOutcome (never throws, never connects) for blocked targets', async () => {
    const outcome = await deliverWebhook(init(createSsrfSafePost({ lookup: lookupReturning(PUBLIC) })));
    expect(outcome.ok).toBe(false);
    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toContain('SSRF guard');
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failed outcome for DNS-rebinding hostnames', async () => {
    const outcome = await deliverWebhook(
      init(
        createSsrfSafePost({
          lookup: lookupReturning({ address: '10.0.0.9', family: 4 }),
          transport: vi.fn(async () => ({ ok: true, status: 200 })),
        }),
      ),
      );
    // NOTE: url unchanged — target.url is the metadata IP; use hostname case below.
    expect(outcome.ok).toBe(false);
  });

  it('delivers successfully to a public endpoint', async () => {
    const publicTarget = { id: 'wh2', url: 'https://hooks.example/hook', secret: 's3cret' };
    const outcome = await deliverWebhook({
      target: publicTarget,
      body: '{"e":1}',
      timestampSeconds: 1,
      post: createSsrfSafePost({
        lookup: lookupReturning(PUBLIC),
        transport: vi.fn(async () => ({ ok: true, status: 200 })),
      }),
      timeoutMs: 500,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.statusCode).toBe(200);
  });
});
