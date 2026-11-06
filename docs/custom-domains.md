# Custom domains — manual DNS flow (T24 / issue #24)

How a workspace serves a published document from its own hostname, with **no
third-party dependency required**: the manual DNS verification fallback works
with nothing configured, and Cloudflare for SaaS is used automatically when its
API token is present.

Spec references: §2 (middleware `host → document routing`), §8 step 5 (routing
table / KV entry + CDN purge), §10.1 (`GET *` on custom hostname → rewrite to
`_host`), §13 (Custom domain: no | 1 | 5), §14 (settings surface).

---

## 1. The flow

```
add hostname  →  publish DNS records  →  verify  →  routed (serves over HTTPS)
                     (TXT + CNAME)        (re-runnable)      │
                                                     remove → unroute + cache purge
```

State machine: **`pending` → `verified`**. Only a `verified` row ever enters
the routing table — an unverified domain can never serve traffic, no matter
what DNS says.

### 1.1 Add (settings → Custom domains, or `POST /api/v1/domains`)

- Body: `{ "hostname": "docs.example.com", "documentId": "doc uuid" }`.
- The document must exist **in the caller's workspace** (cross-tenant guard).
- Hostnames are globally unique → `409 CONFLICT` when already attached (by any
  workspace).
- Plan gate (spec §4 `can()` is the only gating function):
  - Free: `can('customDomains')` is false → **402 PLAN_LIMIT** (`requiredPlan: pro`).
  - Pro: 1 domain, Business: 5 — excess → 402 with the required plan.
- The domain is stored as `pending` and the API returns the **DNS instructions**
  (`{ domain, instructions: { records: [TXT, CNAME] } }`).

### 1.2 DNS records to publish (manual fallback)

| # | Type | Name | Value | Purpose |
|---|------|------|-------|---------|
| 1 | TXT | `_formforge-verify.<hostname>` | `ff-domain-verification=<32-hex token>` | Proves you control the hostname |
| 2 | CNAME | `<hostname>` | `sites.formforge.app` (or `FORMFORGE_ROUTING_TARGET`) | Routes traffic for this hostname to FormForge |

- **Apex domains** (`example.com`, no subdomain) usually cannot CNAME — use
  your DNS provider's ALIAS/ANAME record pointing at the routing target
  instead; verification (TXT) is unaffected.
- The verification token is visible to the workspace in settings/API — by
  design: it only proves DNS control of the hostname, it never grants API
  access. Values are compared in constant time.

### 1.3 Verify (`POST /api/v1/domains/:id/verify`)

The server re-checks DNS:

1. TXT `_formforge-verify.<hostname>` — any record whose value parses to the
   stored token proves ownership (`method: "txt"`).
2. Otherwise a CNAME (or ALIAS chain) pointing **exactly** at the routing
   target proves routing intent (`method: "cname"`).

Outcomes:

- Proven → status flips to `verified`, and the **routing table** gains
  `hostname → documentId`. This is the only write path into the routing table.
- Not proven → stays `pending`, `lastError` records the failure, **no routing
  entry**. Re-run anytime (idempotent for already-verified domains).

### 1.4 Serving traffic

`apps/web/middleware.ts` (edge):

1. Skips the deployment's own hosts (`NEXT_PUBLIC_APP_URL`, `PUBLIC_BASE_URL`,
   `VERCEL_URL`, localhost) and app-owned path prefixes (`/api`, `/_host`,
   `/_next`, `/dashboard`, `/settings`, `/login`, `/register`, `/templates`,
   `/embed`, `/p`, `/d`).
2. Foreign host + page path → resolves `Host` → `documentId` through
   `GET /api/internal/host-route?host=…` (the edge runtime cannot reach
   Postgres; the node route reads the `domain_routes` table and answers
   `null` for unknown/unverified hosts — fail closed).
3. Mapped → rewrite to `/_host/<path>` with `x-ff-document-id` +
   `x-ff-custom-host` headers. The `_host/[...path]` route renders the
   published snapshot (scroll renderer for pages/portfolios, 410 "gone" when
   the document was unpublished, 404 when not rewritten).
4. Lookups are cached per-isolate for **15 s** (`HOST_ROUTE_TTL_MS`);
   resolver failures resolve to `null` — custom domains never 500 the edge.

Forms served through a custom hostname render via the conversational plane in
a follow-up ticket (same integration debt as `/p/:slug`).

### 1.5 Remove (`DELETE /api/v1/domains?id=…`)

Order matters: **routing entry removed first** (traffic stops), then the row
is deleted, then the **same CDN purge seam T10 publish/unpublish uses** fires
(`doc:<id>` tag + `host:<hostname>` key), then best-effort edge deprovision
(Cloudflare mode only; failures never block the removal).

---

## 2. Cloudflare for SaaS (optional)

Set `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ZONE_ID`) and the flow switches
automatically: `POST /zones/{zone}/custom_hostnames` creates the custom
hostname with pre-validation, the returned ownership record is shown in
settings, and removal deprovisions the custom hostname. `provisionMode`
records `cloudflare` vs `manual` per domain. Without the token the manual
fallback above is used — same interface, same verification, same routing.

Staging override: `FORMFORGE_ROUTING_TARGET` changes the CNAME target in the
displayed instructions (e.g. `sites.staging.formforge.app`).

---

## 3. API surface (`/api/v1`, session or bearer with `docs:write`)

| Method & path | Result |
|---|---|
| `GET /domains` | `{ data: CustomDomain[], nextCursor: null }` — verification state visible |
| `POST /domains` | `201 { domain, instructions }`; 402/409/422 per above |
| `POST /domains/:id/verify` | `200 { domain, verified, method }` — `verified:false` is **not** an error |
| `DELETE /domains?id=…` | `204`; routing table updated + caches purged |

OpenAPI: `packages/schema/src/api/spec.ts` documents 402/409/422 responses.

---

## 4. Staging manual check (acceptance: "serves the published document over HTTPS")

Recorded checks are recorded against a staging deployment (`FORMFORGE_ROUTING_TARGET`
pointing at the staging edge). Procedure:

1. `POST /api/v1/domains` with a hostname you control; note the TXT token.
2. Publish the TXT + CNAME at your DNS provider; `dig TXT _formforge-verify.<host>` shows the token.
3. `POST /api/v1/domains/:id/verify` → `verified: true, method: "txt"`.
4. `curl -sI https://<hostname>/ -H 'Host: <hostname>'` → `200` from the
   published page; `GET https://<hostname>/` in a browser shows the document.
5. `DELETE /api/v1/domains?id=…` → repeat step 4 → no longer served (routing entry gone).
6. Negative check: skip step 3 → the hostname never serves (middleware passes
   the request through; no routing entry exists).

> **Status:** not executed in this ticket's sandbox (no staging deployment or
> live DNS available). The middleware mapping, verification state machine,
> 402 gating and removal/purge paths are covered by unit tests (see
> `packages/core/src/domains/__tests__/domains.test.ts`,
> `apps/web/lib/domains/host-routing.test.ts`,
> `apps/web/app/api/v1/domains/route.test.ts`). A Playwright e2e for this
> flow should be added once the repo's e2e harness lands.
