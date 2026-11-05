# FormForge tickets 16-29 (dependency order).
T16 = {
    "n": 16, "slug": "uploads", "title": "M4: File uploads — presign/confirm/scan, 10 MB cap, image pipeline",
    "blocked": [9, 14],
    "build": "`assets` module + S3/R2 per spec §1/§6/§10.1: public `POST /api/public/uploads/presign` (presigned PUT) and `/confirm` (queue scan); authenticated `/api/v1/assets/presign|confirm` for media. Size caps (10 MB, 50 MB when plan allows later via can()), MIME allowlist, magic-byte check, scan_status lifecycle (pending→clean/infected/skipped in dev), signed downloads only. `file-upload` block (answerSchema {assetIds[]}, maxFiles, accept, maxSizeMb ≤10). Image processing job: WebP/AVIF variants, responsive srcset, blur placeholder. MinIO locally via docker-compose.",
    "accept": ["E2E: 10-question form including a 10 MB upload completes; asset visible with signed URL", "MIME/type spoof (renamed .exe) rejected by magic-byte check (test)", "Over-cap upload rejected with VALIDATION error before presign", "Generated image variants served with srcset + blur placeholder in renderer"],
}
T17 = {
    "n": 17, "slug": "jobs-fanout-webhooks", "title": "M4/M7: Background jobs — events fan-out, notification email, webhooks with signing + retries + replay",
    "blocked": [14],
    "build": "BullMQ queues per spec §12 in `apps/worker`: `events` (submission.completed fan-out: notification email + webhooks + analytics hook), `email` (Resend React Email templates; send-notification first), `webhooks` (deliver with `X-FormForge-Signature: t=<unix>,v1=<hmac_sha256(secret, t+'.'+body)>`; backoff 1m/5m/30m/2h/12h; log every attempt to webhook_deliveries; disable after 10 consecutive failures). Webhook CRUD API + Integrate screen (create, secret reveal once, delivery log, replay button → POST /webhooks/:id/deliveries/:did/replay). Never log answer values.",
    "accept": ["Failing webhook endpoint retried on the exact backoff schedule, every attempt visible in delivery log (integration test)", "Replay re-delivers and logs a new attempt", "Signature verified by a test consumer; tampered body rejected; stale timestamp (>5min) rejected", "After 10 consecutive failures webhook auto-disables and owner notified", "Notification email renders for a completed submission (dev transport)"],
}
T18 = {
    "n": 18, "slug": "csv-export", "title": "M7: CSV export job with emailed signed link",
    "blocked": [15, 17],
    "build": "`exports` queue job per spec §12: stream submission rows by cursor to S3 (CSV, one column per question), generate 7-day signed link, send via `send-export-ready` email. API `POST /api/v1/documents/:id/exports` (submissions:read) accepts {from?, to?}. Exports screen section in Results showing job status + link.",
    "accept": ["10k-row fixture export completes <5min in CI (or documented on comparable hardware) with correct column ordering", "Signed link expires after 7 days (unit test on TTL) and is not guessable", "from/to date filters respected", "Email contains the link; no answer data in email body"],
}
T19 = {
    "n": 19, "slug": "analytics", "title": "M7: Analytics pipeline (beacons, partitions, rollups) + Analytics tab",
    "blocked": [15],
    "build": "Per spec §6/§12: `POST /api/public/a` batch beacon ingest (view/start/question_view/question_pass/complete, session_hash, block_id, props); `analytics_events` partitioned by range(ts) with `create-partitions` maintenance job; `rollup` job (hourly for today, daily rollup) into `analytics_daily`; Analytics tab per spec §14.1.5 (views, starts, completes, completion rate, 30-day trend); drop-off per question gated by `can(workspaceId,'advanced_analytics')` (gate open-stub until T23 lands, then flip). Consent: no IP storage, hash session ids (spec §4 logging rule).",
    "accept": ["Beacon batch inserts events; malformed batches rejected cleanly", "Rollup produces analytics_daily matching raw events on a fixture (single-source test: Analytics tab totals == submissions count source)", "Partitions created for current + next month by maintenance job", "Analytics tab renders KPIs + 30-day trend from rollups"],
}
T20 = {
    "n": 20, "slug": "logic-builder-ui", "title": "M5: Logic builder canvas (React Flow) + hidden fields + prefill runtime",
    "blocked": [8, 13],
    "build": "`/d/:docId/logic` per spec §14.1.4: React Flow canvas (nodes: start, question blocks, endings; edges = default flow), clicking node opens drawer to add/edit rules (IF conditions with AND from §7 ops, THEN goto/set, \"in all other cases\" fallback toggle). Autosave with Saved chip (rule.upsert/remove ops through T7 PATCH). Hidden fields (UTM capture) config; per-question prefill via URL param. Runtime integration: conversational renderer uses compiled routing (T12), ingest computes next via engine (T14) — verify both consume T13's package unchanged.",
    "accept": ["\"If NPS ≤ 6 go to ending B, otherwise ending A\" works in builder preview AND live published form", "Dangling goto target blocks publish with clear error naming the rule", "Hidden UTM fields captured end-to-end and visible in results drawer", "Canvas renders default edges from document order; editing a rule autosaves ≤2s with Saved chip"],
}
T21 = {
    "n": 21, "slug": "content-blocks", "title": "M6: Remaining content blocks + image pipeline integration",
    "blocked": [8, 12],
    "build": "Blocks per spec §7.2: `gallery` (grid/masonry, columns), `video` (YouTube/Vimeo allowlist), `testimonials`, `faq`, `pricing`, `projects` (portfolio), `contact-links`, `section`, `columns` (2–4), `multi-question-page` (children questions, map of child answers), `form-embed` (documentId of published form; renders `/embed/:documentId` iframe with postMessage {ff:height},{ff:complete:submissionToken}). Uses image variants/srcset/blur from T16. Palette categories updated per doc type (questions for forms, content for pages/portfolios).",
    "accept": ["All blocks render from defaultProps without error; props schemas round-trip through editor", "form-embed posts height and complete events; parent listens (test harness page)", "multi-question-page stores map of child answers matching §7.2", "Video only allows allowlisted hosts (unit test rejects others)"],
}
T22 = {
    "n": 22, "slug": "templates-embeds", "title": "M6: Template gallery (≥14) + embed loader (3 modes, postMessage)",
    "blocked": [21],
    "build": "≥14 original templates per spec §14.1.9 stored as DocumentBody JSON in `packages/core/src/documents/templates/` (≥6 forms, ≥4 landing pages, ≥4 portfolios), all validating against DocumentBody. Templates gallery (marketing + in-app), \"Use template\" flow (copies into workspace as draft). Embed loader `/embed.v1.js`: standard div, popup, full-page modes; iframe postMessage API per spec §10.2; public docs page for embed code.",
    "accept": ["A portfolio with projects + gallery + embedded inquiry form can be built from a template in <5 minutes (usability walkthrough recorded)", "Submitting the embedded form creates a submission on the source form, visible in its Results", "Embed works on a plain HTML test page and auto-resizes height", "All templates pass DocumentBody validation in a CI test"],
}
T23 = {
    "n": 23, "slug": "billing", "title": "M7: Billing — Stripe checkout/portal/webhooks + can() entitlements + seats",
    "blocked": [4],
    "build": "Per spec §13: `billing.can(workspaceId, capability)` as the ONLY gating function (cached entitlements from workspaces.plan); Stripe Checkout + Customer Portal + webhooks (`/api/webhooks/stripe`: checkout.session.completed, customer.subscription.updated/deleted, invoice.payment_failed; verify signature; idempotent by event id; update plan); PLAN_LIMIT → HTTP 402 {capability, requiredPlan} with upgrade prompt ONLY in settings/error responses (never inside editing surfaces). Seats: plan seat limits (1/3/10) + member invitations UI. Entitlement table per §13 (upload size, branding, custom domains, analytics, partial submissions, webhooks).",
    "accept": ["Stripe test-mode upgrade unlocks capabilities within 30s; downgrade re-locks them (integration test with webhook fixtures)", "Webhook replayed twice updates plan once (idempotency test)", "Over-limit action returns 402 with capability + requiredPlan; UI shows upgrade only in settings", "can() unit-tested against all §13 rows per plan"],
}
T24 = {
    "n": 24, "slug": "custom-domains", "title": "M7: Custom domain manual flow (DNS verify → route)",
    "blocked": [12, 23],
    "build": "Per spec §7 domains module + §14 settings: add custom hostname (Pro 1, Business 5 via can()), show DNS instructions, verify ownership, register routing so middleware maps Host → documentId (KV/routing table per §8 publish step) and rewrites to `_host/[...path]` per spec §2. Cloudflare for SaaS integration behind CLOUDFLARE_API_TOKEN when configured; manual DNS verification fallback documented.",
    "accept": ["Custom hostname serves the published document over HTTPS (recorded manual check in staging)", "Unverified domain blocked from routing; verification state visible in settings", "Domain limit enforced by can() with 402 on excess", "Removing a domain updates routing table + purges cache"],
}
T25 = {
    "n": 25, "slug": "api-tokens-openapi", "title": "M8: API tokens + scopes + OpenAPI generated from Zod",
    "blocked": [4, 7],
    "build": "Per spec §6/§11: api_tokens already migrated (T2) — CRUD UI + routes (session only), sha256 token_hash stored, plaintext shown once, scopes (docs:read docs:write docs:publish submissions:read), last_used_at. Bearer auth path for /api/v1 (token's workspace). OpenAPI document generated from the Zod schemas (single source). Rate limits: 600 req/min per token, 300 per session. Spec §14.1.8 settings/tokens screen.",
    "accept": ["Sample script: using ONLY a token, create → publish → read a form via API (spec M8 acceptance)", "Scoped token cannot call outside its scopes (403, test per scope)", "OpenAPI spec validates (validator) and matches live routes on a sample", "Token plaintext never stored or logged; reveal-once enforced"],
}
T26 = {
    "n": 26, "slug": "mcp-server", "title": "M8: MCP server — 7 tools, no deletes, audit logging",
    "blocked": [25],
    "build": "MCP server exposing exactly: list_documents, get_document, create_document, apply_ops, publish_document, list_submissions, summarize_responses (spec §15 M8). NO delete tools. Auth via workspace API token; workspace from token; Ctx actor type 'mcp'. Every tool call appended to audit_log with actor_type='mcp' (spec §6). Cross-workspace IDs rejected with FORBIDDEN.",
    "accept": ["Sample MCP client lists, creates, applies ops, publishes, reads submissions end-to-end", "Tool calls appear in audit_log with actor_type='mcp' and correct target", "Cross-workspace document ID rejected (test)", "No delete capability exists on the server surface (enumeration test)"],
}
T27 = {
    "n": 27, "slug": "ai-draft", "title": "M8: AI draft + edit-with-AI + monthly quota",
    "blocked": [25],
    "build": "`ai` module per spec §15 M8: prompt → DocumentBody draft (strict schema validation with ONE repair attempt; clear failure otherwise); \"edit with AI\" generating ops (block.update/insert...) applied ONLY after user confirmation in a reviewable diff; per-workspace monthly quota via usage_counters; ANTHROPIC_API_KEY + AI_MODEL from env (spec §5). Editor surface: AI actions accessible from builder without breaking optimistic autosave.",
    "accept": ["Generated draft always passes DocumentBody validation or returns a clear failure (golden prompt tests, mocked model)", "AI ops never applied without explicit user confirmation (UI + service-level guard test)", "Quota exhausted → PLAN_LIMIT 402 with capability=ai", "No answer data or secrets sent to the model beyond the prompt context"],
}
T28 = {
    "n": 28, "slug": "a11y-perf", "title": "Hardening: Accessibility (WCAG 2.1 AA) + performance budgets across all surfaces",
    "blocked": [11, 12, 15, 20, 21],
    "build": "Per spec §14.4/§16/§18: axe-core in Playwright for builder, dashboard, public form, public page — zero critical violations; keyboard reachability with visible focus everywhere; labels on all inputs; ARIA live region announcing validation errors + question changes in conversational renderer; contrast ≥4.5:1; reduced-motion respected. Lighthouse CI budgets (perf ≥90 desktop / ≥85 mobile, a11y ≥90); bundle budgets enforced (renderer ≤120KB); builder interactive <3s target. Fix all violations found.",
    "accept": ["axe runs in CI on all four surfaces with zero critical violations", "Full keyboard sweep: every interactive element reachable + visible focus (documented pass)", "Lighthouse CI thresholds met on published form + portfolio", "Bundle budget gate green; reduced-motion honored (test with emulation)"],
}
T29 = {
    "n": 29, "slug": "security-launch", "title": "Hardening: Security checklist (spec §17) + GDPR + launch readiness",
    "blocked": [16, 17, 22, 28],
    "build": "Verify spec §17 checklist with tests/evidence: RLS everywhere, argon2id + rate limits, hashed shown-once tokens, rich text sanitized on save AND snapshot build (allowlist, no raw HTML blocks), strict CSP on public pages, sandboxed allowlisted embeds, upload hardening (already in T16 — re-verify), webhook SSRF protection (block private IP ranges, resolve DNS then connect to resolved IP), Turnstile+honeypot+limits, publish-time sensitive-field warning, \"Report abuse\" link + admin takedown (archived + cache purge), secrets audit (env only, none in logs/bundles). GDPR: workspace data export, workspace+account deletion, per-form retention setting, DPA page. Backups with tested restore (documented runbook).",
    "accept": ["Every §17 item checked with a link to test or documented manual evidence", "XSS payloads in rich text and answers neutralized (test suite)", "SSRF: webhook delivery to 169.254.169.254 / 10.x / localhost blocked (test)", "Workspace export + deletion flows work e2e; deleted data purged within retention window", "Restore runbook executed once against a backup (recorded)"],
}
