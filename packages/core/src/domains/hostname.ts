/**
 * T24 — hostname normalization + validation and the DNS verification protocol.
 *
 * Manual DNS fallback (spec §2 "Edge / domains", §5 CLOUDFLARE_* envs): the user
 * adds a TXT record proving control of the hostname and a CNAME pointing at the
 * FormForge routing target. Protocol literals (record names/values) live here —
 * the settings UI and the verify service both read them from this module.
 */

/** Longest valid FQDN per RFC 1035. */
export const MAX_HOSTNAME_LENGTH = 253;

/** Name of the TXT record proving domain ownership. */
export const VERIFICATION_TXT_PREFIX = '_formforge-verify.';
/** Prefix of the TXT value carrying the per-domain verification token. */
export const VERIFICATION_TXT_VALUE_PREFIX = 'ff-domain-verification=';

/**
 * Normalize user input into a bare hostname: trim, strip scheme/port/path,
 * lowercase, drop a single trailing dot (the DNS root marker). Does NOT validate —
 * pair with {@link validateHostname}.
 */
export function normalizeHostname(raw: string): string {
  let host = raw.trim();
  // strip scheme (docs.example.com inside https://docs.example.com/path)
  const schemeEnd = host.indexOf('://');
  if (schemeEnd !== -1) host = host.slice(schemeEnd + 3);
  // strip path
  const slash = host.indexOf('/');
  if (slash !== -1) host = host.slice(0, slash);
  // strip port (but never strip from an IPv6 literal — out of scope, rejected later)
  if (!host.endsWith(']')) {
    const colon = host.lastIndexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }
  // strip userinfo (user@host)
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  host = host.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/** Field-level issues for the §4 error shape (path is always "hostname"). */
export function validateHostname(
  normalized: string,
): ReadonlyArray<{ path: string; message: string }> {
  const issues: { path: string; message: string }[] = [];
  const fail = (message: string): void => {
    issues.push({ path: 'hostname', message });
  };

  if (normalized.length === 0) {
    fail('Hostname is required');
    return issues;
  }
  if (normalized.length > MAX_HOSTNAME_LENGTH) {
    fail(`Hostname must be at most ${MAX_HOSTNAME_LENGTH} characters`);
    return issues;
  }
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    fail('Hostname may only contain lowercase letters, digits, dots and hyphens');
    return issues;
  }
  const labels = normalized.split('.');
  if (labels.length < 2) {
    fail('Hostname must include a domain suffix (e.g. "docs.example.com")');
    return issues;
  }
  for (const label of labels) {
    if (label.length === 0) {
      fail('Hostname has an empty label (consecutive dots)');
      return issues;
    }
    if (label.length > 63) {
      fail('Hostname labels must be at most 63 characters');
      return issues;
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      fail('Hostname labels must not start or end with a hyphen');
      return issues;
    }
  }
  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,}$/.test(tld)) {
    fail('Hostname must end in a top-level domain (letters only, ≥ 2 chars)');
  }
  return issues;
}

/** `true` when the raw input normalizes + validates cleanly. */
export function isHostnameValid(raw: string): boolean {
  return validateHostname(normalizeHostname(raw)).length === 0;
}

/** Full name of the ownership-proof TXT record for a hostname. */
export function verificationTxtName(hostname: string): string {
  return `${VERIFICATION_TXT_PREFIX}${hostname}`;
}

/** The exact TXT value the customer must publish for `token`. */
export function verificationTxtValue(token: string): string {
  return `${VERIFICATION_TXT_VALUE_PREFIX}${token}`;
}

/** Extract the token out of a published TXT value (null when it is not ours). */
export function parseVerificationValue(value: string): string | null {
  // Some resolvers/DNS panels keep the quotes around TXT strings — strip them.
  const trimmed = value.trim().replace(/^"+|"+$/g, '');
  if (!trimmed.startsWith(VERIFICATION_TXT_VALUE_PREFIX)) return null;
  const token = trimmed.slice(VERIFICATION_TXT_VALUE_PREFIX.length);
  return token.length > 0 ? token : null;
}

/** Random per-domain verification token (32 hex chars) — crypto-random, unguessable. */
export function generateVerificationToken(): string {
  // node:crypto is available in every runtime that runs the domains service
  // (web server + worker). The edge middleware never needs it.
  return randomHex(16);
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The customer-facing DNS records for the manual fallback flow:
 *  1. TXT ownership proof (consumed by `verifyDomain`);
 *  2. CNAME pointing the hostname at the FormForge routing target so traffic
 *     actually reaches us once DNS resolves (apex zones need an ALIAS/ANAME —
 *     documented in the settings UI).
 */
export function manualDnsInstructions(
  hostname: string,
  routingTarget: string,
  verificationToken: string,
): {
  mode: 'manual';
  records: [
    { type: 'TXT'; name: string; value: string; purpose: string },
    { type: 'CNAME'; name: string; value: string; purpose: string },
  ];
} {
  return {
    mode: 'manual',
    records: [
      {
        type: 'TXT',
        name: verificationTxtName(hostname),
        value: verificationTxtValue(verificationToken),
        purpose: 'Proves you control the hostname',
      },
      {
        type: 'CNAME',
        name: hostname,
        value: routingTarget,
        purpose: 'Routes traffic for this hostname to FormForge',
      },
    ],
  };
}
