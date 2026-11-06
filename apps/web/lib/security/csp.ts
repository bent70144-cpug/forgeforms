// T29 (spec §17: "Strict CSP on public pages; user-supplied embeds only via
// sandboxed iframes with allowlisted hosts").
//
// Pure, framework-free CSP builder + public-path classifier so the policy is
// unit-testable outside Next.js (apps/web/tests/public-csp.test.ts); the
// middleware (apps/web/middleware.ts) only wires it onto responses.
//
// WHY TWO POLICIES
// ----------------
//  - NONCE policy (dynamic surfaces): `/embed/*` is `force-dynamic`, so a
//    per-request nonce is always fresh — the strict `nonce-… 'strict-dynamic'`
//    policy from the Next.js CSP guide applies and inline/remote script
//    injection dies even if the sanitizer ever missed something.
//  - STATIC policy (ISR-cached surfaces): `/p/:slug` + `/_host/*` serve cached
//    HTML (revalidate 60 — spec §10.1, LCP < 2s, "keep serving while the DB is
//    stopped"). A nonce baked into cached HTML would mismatch on replay and
//    brick hydration, so these planes get a host-allowlist policy WITHOUT a
//    nonce: scripts still only load from ourselves + Cloudflare Turnstile, and
//    every other directive stays locked. The XSS boundary there remains the
//    §17 allowlist sanitizer (save + snapshot build).
//
// SANDBOXED EMBEDS
// ----------------
// User-supplied embeds are rendered by `@formforge/blocks` `video` /
// `form-embed` renderers, which enforce an EXACT-hostname allowlist before any
// iframe src is produced (packages/blocks/src/video/url.ts). frame-src here is
// the CSP mirror of that allowlist — a block bug and a CSP violation would
// both have to happen for a foreign frame to load.

/** Hosts a sandboxed, user-configured iframe may point at (CSP mirror). */
export const EMBED_FRAME_HOSTS: readonly string[] = [
  "https://www.youtube-nocookie.com",
  "https://www.youtube.com",
  "https://player.vimeo.com",
  "https://calendly.com",
];

/** Turnstile widget origin (ingest captcha, spec §10.3). */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export type PublicCspOptions = {
  /**
   * Per-request nonce for the strict policy. Omit/null → static (host
   * allowlist) policy, used on ISR-cached public planes.
   */
  readonly nonce?: string | null;
  /**
   * True on iframe-able embed surfaces (`/embed/*`): `frame-ancestors *`.
   * Every other public page forbids framing outside ourselves.
   */
  readonly embed: boolean;
  /**
   * True only when NODE_ENV=development: Next.js dev-mode HMR evaluates
   * strings (`unsafe-eval`), so the dev server would otherwise break on every
   * page — a dev-only relaxation; production keeps the strict policy.
   */
  readonly devMode?: boolean;
};

/** Build the §17 Content-Security-Policy value for a public page response. */
export function buildPublicPageCsp(options: PublicCspOptions): string {
  const scriptSrc = options.nonce
    ? // Strict-dynamic: CSP3 browsers trust only nonce-propagated scripts;
      // `https:` + 'unsafe-inline' are ignored there and act as the CSP2
      // fallback (Next.js CSP guide pattern).
      `'self' 'nonce-${options.nonce}' 'strict-dynamic' https: 'unsafe-inline'`
    : // Static planes (ISR-cached HTML): no nonce available — lock to our
      // origin + the Turnstile widget; inline bootstrap scripts allowed.
      `'self' 'unsafe-inline'${options.devMode ? " 'unsafe-eval'" : ""} ${TURNSTILE_ORIGIN}`;

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Inline <style> blocks (conversational plane ships a <style> tag) and
    // framework-injected style attributes are required by the renderers.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Beacon/ingest + Turnstile token verification (client-side widget calls).
    `connect-src 'self' ${TURNSTILE_ORIGIN}`,
    // Sandboxed, allowlisted embeds ONLY (spec §17); 'self' covers the
    // form-embed child iframe (/embed/:docId).
    `frame-src 'self' ${EMBED_FRAME_HOSTS.join(" ")}`,
    "media-src 'self' https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    options.embed ? "frame-ancestors *" : "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

/** Extra hardening headers every public page response carries. */
export function publicSecurityHeaders(csp: string): Record<string, string> {
  return {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

export type PublicPageKind =
  /** Nonce (strict) CSP — force-dynamic embed surface, frameable by parents. */
  | { kind: "embed" }
  /** Static policy — ISR-cached public documents (also custom-host render). */
  | { kind: "document" }
  /** Static policy — marketing/DPA/abuse pages and the site root. */
  | { kind: "marketing" }
  /** Not a public page (dashboard, auth, API, …) — middleware adds nothing. */
  | { kind: null };

/**
 * Classify a pathname for CSP application. Ordered prefixes; the matcher in
 * middleware.ts guarantees api/_next/static traffic never reaches this.
 */
export function classifyPublicPagePath(pathname: string): PublicPageKind {
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return { kind: "embed" };
  if (pathname === "/p" || pathname.startsWith("/p/")) return { kind: "document" };
  // Marketing group: root, templates, DPA, report-abuse (static, no user HTML).
  if (
    pathname === "/" ||
    pathname === "/templates" ||
    pathname.startsWith("/templates/") ||
    pathname === "/dpa" ||
    pathname.startsWith("/dpa/") ||
    pathname === "/report-abuse" ||
    pathname.startsWith("/report-abuse/")
  ) {
    return { kind: "marketing" };
  }
  return { kind: null };
}

/**
 * The middleware's one-stop helper: CSP headers for a public page request, or
 * null when the path is not a public page (dashboard/auth/API — untouched).
 */
export function publicPageHeadersFor(
  pathname: string,
  nonce: string,
): Record<string, string> | null {
  const page = classifyPublicPagePath(pathname);
  if (page.kind === null) return null;
  if (page.kind === "embed") {
    return publicSecurityHeaders(
      buildPublicPageCsp({ nonce, embed: true, devMode: process.env.NODE_ENV === "development" }),
    );
  }
  // document + marketing: ISR/prerendered HTML — static policy (see header
  // comment for why nonce-CSP would break cached pages).
  return publicSecurityHeaders(
      buildPublicPageCsp({ nonce: null, embed: false, devMode: process.env.NODE_ENV === "development" }),
    );
}
