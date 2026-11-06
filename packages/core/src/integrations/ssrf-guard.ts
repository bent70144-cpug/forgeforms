// T29 — SSRF guard for webhook egress (spec §17: "SSRF protection on outbound
// URLs (block private IP ranges, resolve DNS then connect to the resolved IP)").
//
// Threat model: webhook endpoint URLs are user-supplied. Without a guard, a
// tenant could point a webhook at cloud metadata (169.254.169.254), internal
// services (10.x, 192.168.x, 127.0.0.1, ::1) or rebind a public hostname to an
// internal address between check and connect (TOCTOU).
//
// Defense (three layers):
//   1. URL policy  — http/https only, no userinfo, no localhost names, no
//      IP-literal or all-numeric hostnames that point at blocked ranges.
//   2. DNS policy  — the hostname is resolved with `all: true` and EVERY
//      address must be public. One blocked address rejects the request
//      (fail closed). Revalidation happens inside the transport's lookup.
//   3. Transport   — `createSsrfSafePost` connects to a VALIDATED address:
//      the custom `lookup` handed to node:http(s) resolves once, validates,
//      and the socket connects to exactly that address (no second resolution,
//      no TOCTOU window). TLS SNI/hostname verification still uses the
//      original hostname, so certificates keep working.
import { isIP } from 'node:net';
import { WEBHOOK_TIMEOUT_MS, type HttpPost } from './webhook-dispatcher';

// ---------------------------------------------------------------------------
// Blocked ranges
// ---------------------------------------------------------------------------

const v4ToInt = (ip: string): number => {
  const parts = ip.split('.').map((p) => Number(p));
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
};

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

function ipv6ToBigInt(ip: string): bigint | null {
  const pct = ip.indexOf('%');
  let clean = pct === -1 ? ip : ip.slice(0, pct); // strip zone id (fe80::1%eth0)
  if (!clean.includes(':')) return null;
  // Dotted-quad tail (::ffff:192.168.0.1) → two hex groups.
  const v4Match = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(clean);
  if (v4Match) {
    const octets = v4Match[1]!.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    clean = `${clean.slice(0, v4Match.index + 1)}${hi}:${lo}`;
  }
  let head = clean;
  let tail = '';
  const dc = clean.indexOf('::');
  if (dc !== -1) {
    head = clean.slice(0, dc);
    tail = clean.slice(dc + 2);
  }
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const fill = 8 - headGroups.length - tailGroups.length;
  if (dc === -1 && headGroups.length !== 8) return null;
  if (fill < 0) return null;
  const groups = [...headGroups, ...Array<string>(dc === -1 ? 0 : fill).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function inV6Range(ip: bigint, base: bigint, bits: number): boolean {
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (ip & mask) === (base & mask);
}

/** IPv4-mapped (::ffff:a.b.c.d) — unwrap and validate as IPv4. */
function unwrapV4Mapped(ip: bigint): string | null {
  const mappedMask = (1n << 32n) - 1n;
  if ((ip >> 32n) !== 0xffffn) return null;
  const v4 = Number(ip & mappedMask);
  return [v4 >>> 24, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff].join('.');
}

/**
 * True when `ip` is private, link-local, loopback, reserved, multicast or
 * otherwise unsafe as a webhook destination. IPv4-mapped IPv6 is unwrapped.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return (
      inCidr(ip, '0.0.0.0', 8) || // "this network"
      inCidr(ip, '10.0.0.0', 8) || // private
      inCidr(ip, '100.64.0.0', 10) || // CGNAT
      inCidr(ip, '127.0.0.0', 8) || // loopback
      inCidr(ip, '169.254.0.0', 16) || // link-local (incl. 169.254.169.254 metadata)
      inCidr(ip, '172.16.0.0', 12) || // private
      inCidr(ip, '192.0.0.0', 24) || // IETF protocol assignments
      inCidr(ip, '192.0.2.0', 24) || // TEST-NET-1
      inCidr(ip, '192.88.99.0', 24) || // 6to4 relay anycast (deprecated)
      inCidr(ip, '192.168.0.0', 16) || // private
      inCidr(ip, '198.18.0.0', 15) || // benchmarking
      inCidr(ip, '198.51.100.0', 24) || // TEST-NET-2
      inCidr(ip, '203.0.113.0', 24) || // TEST-NET-3
      inCidr(ip, '224.0.0.0', 4) || // multicast
      inCidr(ip, '240.0.0.0', 4) || // reserved (incl. broadcast)
      ip === '255.255.255.255'
    );
  }
  if (family === 6) {
    const value = ipv6ToBigInt(ip);
    if (value === null) return true; // unparseable → fail closed
    const mapped = unwrapV4Mapped(value);
    if (mapped !== null) return isPrivateOrReservedIp(mapped);
    return (
      inV6Range(value, 0n, 8) || // ::/8 unspecified etc.
      value === 1n || // ::1 loopback
      inV6Range(value, (0x64n << 112n) | (0xff9bn << 96n), 96) || // 64:ff9b::/96 NAT64 (RFC 6052)
      inV6Range(value, 0x100n << 112n, 64) || // 100::/64 discard-only
      inV6Range(value, (0x2001n << 112n) | (0xdb8n << 96n), 32) || // 2001:db8::/32 documentation
      inV6Range(value, 0xfc00n << 112n, 7) || // fc00::/7 unique-local
      inV6Range(value, 0xfe80n << 112n, 10) || // fe80::/10 link-local
      inV6Range(value, 0xff00n << 112n, 8) // ff00::/8 multicast
    );
  }
  return true; // not an IP → treat as unsafe
}

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------

export type WebhookUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const LOCAL_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'metadata.goog',
]);

/** All-numeric / single-label decimal or hex IP-literal spellings (127.0.0.1 = 2130706433). */
function looksLikeIpLiteralSpelling(hostname: string): boolean {
  if (/^\d{8,15}$/.test(hostname)) return true; // decimal dword
  if (/^0x[0-9a-f]{6,12}$/i.test(hostname)) return true; // hex dword
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return false; // dotted quad → handled via isIP
  return false;
}

/**
 * Layer 1 — validate the webhook URL itself. Literal IPs are checked against
 * the blocked ranges; hostnames are deferred to the DNS layer.
 */
export function checkWebhookUrl(rawUrl: string): WebhookUrlCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL is not parseable' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `Scheme "${url.protocol.replace(/:$/, '')}" is not allowed (http/https only)` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'Credentials in the URL (user:pass@host) are not allowed' };
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  if (hostname === '') return { ok: false, reason: 'Empty hostname' };
  if (LOCAL_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `"${hostname}" is blocked (loopback/metadata)` };
  }
  if (hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, reason: `"${hostname}" is blocked (internal namespace)` };
  }
  if (looksLikeIpLiteralSpelling(hostname)) {
    return { ok: false, reason: `Numeric hostname "${hostname}" is not allowed (IP-literal spelling)` };
  }
  if (isIP(hostname) !== 0 && isPrivateOrReservedIp(hostname)) {
    return { ok: false, reason: `IP literal "${hostname}" is private/reserved` };
  }
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// DNS policy + transport
// ---------------------------------------------------------------------------

/** Minimal lookup seam (node:dns.promises.lookup shape, `all: true`). */
export type DnsLookupAll = (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export type SsrfRejection = { ok: false; reason: string };

async function defaultLookup(hostname: string): Promise<ReadonlyArray<{ address: string; family: number }>> {
  const dns = await import('node:dns');
  return dns.promises.lookup(hostname, { all: true, verbatim: true }) as Promise<
    ReadonlyArray<LookupAddress> & ReadonlyArray<{ address: string; family: number }>
  >;
}

/**
 * Layer 2 — resolve `hostname` and require EVERY address to be public.
 * Returns the validated addresses (callers may connect to any of them).
 */
export async function resolveSafeAddresses(
  hostname: string,
  lookup: DnsLookupAll = defaultLookup,
): Promise<{ ok: true; addresses: ReadonlyArray<{ address: string; family: number }> } | SsrfRejection> {
  let records: ReadonlyArray<{ address: string; family: number }>;
  try {
    records = await lookup(hostname);
  } catch (cause) {
    return { ok: false, reason: `DNS resolution failed for "${hostname}": ${(cause as Error)?.message ?? 'error'}` };
  }
  if (records.length === 0) {
    return { ok: false, reason: `DNS returned no addresses for "${hostname}"` };
  }
  const offenders = records.filter((r) => isPrivateOrReservedIp(r.address));
  if (offenders.length > 0) {
    return {
      ok: false,
      reason: `"${hostname}" resolves to a private/reserved address (${offenders[0]!.address}) — blocked`,
    };
  }
  return { ok: true, addresses: records };
}

export type SsrfSafePostOptions = {
  /** Injectable resolver (tests); defaults to node:dns.promises.lookup(all). */
  lookup?: DnsLookupAll;
  /** Injectable transport (tests); defaults to node:https/node:http request. */
  transport?: HttpPost;
  /** Delivery timeout ms. Default 10s (matches WEBHOOK_TIMEOUT_MS). */
  timeoutMs?: number;
};

function validateLookupIp(address: string): void {
  if (isPrivateOrReservedIp(address)) {
    throw new Error(`SSRF guard: refused to connect to private/reserved address ${address}`);
  }
}

/**
 * The custom `lookup` option handed to node:http(s) — this is the mechanism
 * that makes the socket connect to the VALIDATED address ("resolve DNS then
 * connect to the resolved IP"). It re-validates on every call so even a
 * redirect-creating client cannot escape the policy.
 */
function pinnedLookup(
  lookup: DnsLookupAll,
): (hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => void {
  return (hostname, _options, callback) => {
    void (async () => {
      const resolved = await resolveSafeAddresses(hostname, lookup);
      if (!resolved.ok) {
        callback(new Error(resolved.reason), '', 4);
        return;
      }
      const first = resolved.addresses[0]!;
      validateLookupIp(first.address);
      callback(null, first.address, first.family);
    })().catch((cause: unknown) => {
      callback(cause instanceof Error ? cause : new Error(String(cause)), '', 4);
    });
  };
}

type HttpResponseish = { statusCode?: number; on?: (event: string, cb: () => void) => void };

function nodePost(
  url: string,
  init: { headers: Record<string, string>; body: string; signal: AbortSignal },
  lookup: DnsLookupAll,
): Promise<{ ok: boolean; status: number }> {
  return (async () => {
    const urlMod = await import('node:url');
    const parsed = urlMod.parse(url); // legacy API: no redirect following (redirects re-run the guard via lookup)
    const secure = parsed.protocol === 'https:';
    const mod = (await (secure ? import('node:https') : import('node:http'))) as typeof import('node:http');
    const requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname ?? undefined,
      port: parsed.port ?? undefined,
      path: parsed.path ?? undefined,
      method: 'POST',
      headers: init.headers,
      // Layer 3: the socket connects to the address returned by this lookup —
      // a DNS-validated, public IP (never a second, unvalidated resolution).
      lookup: pinnedLookup(lookup),
      ...(secure ? { servername: parsed.hostname ?? undefined } : {}),
    } as Parameters<typeof mod.request>[0];
    return new Promise<{ ok: boolean; status: number }>((resolve, reject) => {
      const req = mod.request(requestOptions, (res: HttpResponseish) => {
        // Drain (bounded) so the socket closes cleanly; body is not needed.
        res.on?.('data', () => {});
        res.on?.('end', () => {});
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status });
      });
      req.setTimeout(WEBHOOK_TIMEOUT_MS, () => req.destroy(new Error('webhook delivery timed out')));
      req.on('error', reject);
      init.signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
      req.end(init.body);
    });
  })();
}

/**
 * Layer 3 — an `HttpPost` for the webhook dispatcher that refuses anything the
 * URL/DNS policy rejects BEFORE opening a socket, and connects only to a
 * validated address. Delivery failures come back as normal DeliveryOutcome
 * errors (never thrown) because the dispatcher wraps this transport.
 */
export function createSsrfSafePost(options: SsrfSafePostOptions = {}): HttpPost {
  const lookup = options.lookup ?? defaultLookup;
  const transport =
    options.transport ??
    ((url, init) => nodePost(url, { headers: init.headers, body: init.body, signal: init.signal }, lookup));

  return async (url, init) => {
    const checked = checkWebhookUrl(url);
    if (!checked.ok) throw new Error(`SSRF guard: ${checked.reason}`);
    const parsed = new URL(url);
    const resolved = await resolveSafeAddresses(parsed.hostname.replace(/^\[|\]$/g, ''), lookup);
    if (!resolved.ok) throw new Error(`SSRF guard: ${resolved.reason}`);
    // Double-check every address again right before connect (cheap, idempotent).
    for (const record of resolved.addresses) validateLookupIp(record.address);
    return transport(url, init);
  };
}
