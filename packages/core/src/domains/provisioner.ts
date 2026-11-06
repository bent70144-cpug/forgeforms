/**
 * T24 — DomainProvisioner implementations.
 *
 *  - `createManualProvisioner(target)`: the fallback used whenever
 *    CLOUDFLARE_API_TOKEN is unset — hands back the TXT/CNAME instructions the
 *    user publishes in their own DNS (ticket: "manual DNS verification fallback
 *    documented").
 *  - `createCloudflareProvisioner(...)`: Cloudflare for SaaS custom hostnames
 *    via the REST API (zero dependencies, fetch-based like billing's gateway).
 *    Failures surface as AppError INTERNAL with the API's error messages.
 */
import { AppError } from "../shared/errors.ts";;
import { manualDnsInstructions } from './hostname.ts';
import type { DomainProvisioner, ProvisionOutcome } from './ports.ts';

/** Manual fallback: no edge calls, instructions only. */
export function createManualProvisioner(routingTarget: string): DomainProvisioner {
  return {
    async provision({ hostname, verificationToken }): Promise<ProvisionOutcome> {
      return {
        mode: 'manual',
        customHostnameId: null,
        instructions: manualDnsInstructions(hostname, routingTarget, verificationToken),
      };
    },
    async deprovision(): Promise<void> {
      /* nothing provisioned at the edge */
    },
  };
}

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export type CloudflareProvisionerOptions = {
  /** CLOUDFLARE_API_TOKEN (spec §5) — needs Cloudflare for SaaS:edit permission. */
  apiToken: string;
  /** CLOUDFLARE_ZONE_ID (spec §5) — the zone that owns custom hostnames. */
  zoneId?: string;
  /** Public routing target customers CNAME to (e.g. "sites.formforge.app"). */
  routingTarget: string;
  /** DI seam for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

interface CloudflareResponse<T> {
  success: boolean;
  errors: ReadonlyArray<{ code: number; message: string }>;
  result: T | null;
}

interface CloudflareCustomHostname {
  id: string;
  hostname: string;
  status?: string;
  ownership_verification?: { type: string; name: string; value: string };
}

/** Cloudflare for SaaS provisioning (POST/DELETE /zones/{zone}/custom_hostnames). */
export function createCloudflareProvisioner(options: CloudflareProvisionerOptions): DomainProvisioner {
  const doFetch = options.fetchImpl ?? fetch;

  async function call<T>(
    path: string,
    init: RequestInit,
  ): Promise<CloudflareResponse<T>> {
    const response = await doFetch(`${CF_API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.apiToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => null)) as CloudflareResponse<T> | null;
    if (!body || body.success !== true) {
      const message = body?.errors?.map((e) => e.message).join('; ') ?? `Cloudflare API error (${response.status})`;
      throw AppError.internal(`Cloudflare for SaaS request failed: ${message}`);
    }
    return body;
  }

  return {
    async provision({ hostname, verificationToken }): Promise<ProvisionOutcome> {
      const path = options.zoneId
        ? `/zones/${options.zoneId}/custom_hostnames`
        : '/custom_hostnames';
      const body = await call<CloudflareCustomHostname>(path, {
        method: 'POST',
        body: JSON.stringify({
          hostname,
          // The SaaS platform target; traffic for `hostname` terminates here.
          ssl: { method: 'sni_changed' },
          // Pre-validation so ownership can be proven before cutover.
          custom_origin_server: options.routingTarget,
        }),
      });
      const result = body.result;
      const customHostnameId = result?.id ?? null;
      return {
        mode: 'cloudflare',
        customHostnameId,
        instructions: {
          mode: 'cloudflare',
          records: [
            {
              type: 'TXT',
              name: result?.ownership_verification?.name ?? `_formforge-verify.${hostname}`,
              value: result?.ownership_verification?.value ?? `ff-domain-verification=${verificationToken}`,
              purpose: 'Proves you control the hostname (Cloudflare for SaaS pre-validation)',
            },
            {
              type: 'CNAME',
              name: hostname,
              value: options.routingTarget,
              purpose: 'Routes traffic for this hostname to FormForge',
            },
          ],
        },
      };
    },

    async deprovision(hostname): Promise<void> {
      // Best-effort: the routing entry is already gone; a stale custom hostname
      // record is harmless and admin-visible in the Cloudflare dashboard.
      const path = options.zoneId
        ? `/zones/${options.zoneId}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`
        : `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`;
      try {
        const listed = await call<CloudflareCustomHostname[]>(path, { method: 'GET' });
        for (const item of listed.result ?? []) {
          if (item.hostname !== hostname || !item.id) continue;
          await call(
            options.zoneId
              ? `/zones/${options.zoneId}/custom_hostnames/${item.id}`
              : `/custom_hostnames/${item.id}`,
            { method: 'DELETE' },
          );
        }
      } catch {
        // deprovision is best-effort by contract (ports.ts).
      }
    },
  };
}
