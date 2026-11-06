/**
 * T24 — node DnsLookup adapter for the manual verification fallback.
 *
 * The port lives in ./ports.ts; THIS implementation imports `node:dns/promises`
 * and therefore must never be imported by edge-runtime code (middleware) — the
 * composition root (apps/web server code) is the only consumer.
 */
import { resolveCname, resolveTxt } from 'node:dns/promises';
import type { DnsLookup } from './ports.ts';

/** Real resolver with a per-call timeout (verification must not hang a request). */
export function createNodeDnsLookup(timeoutMs = 5_000): DnsLookup {
  const withTimeout = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    async txt(name): Promise<string[]> {
      try {
        const records = await withTimeout(resolveTxt(name));
        // Each record arrives as ["ff-domain-verification=…"] — flatten chunks.
        return records.map((chunks) => chunks.join(''));
      } catch {
        return []; // NXDOMAIN/NODATA/etc. → no answer, never a crash
      }
    },
    async cname(name): Promise<string | null> {
      try {
        const chain = await withTimeout(resolveCname(name));
        return chain[0] ?? null;
      } catch {
        return null;
      }
    },
  };
}
