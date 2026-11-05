# FormForge — Ticket Index

Source of truth for scope: [`spec.md`](../spec.md). Authoritative ticket bodies live as GitHub issues
in [github.com/bent70144-cpug/forgeforms](https://github.com/bent70144-cpug/forgeforms/issues) (issues #1–#29, native blocking edges + `ready-for-agent`).
This file is the generation source: `scripts/tickets_a.py` + `scripts/tickets_b.py`,
published by `scripts/publish_tickets.py`.

| # | Issue | Title | Blocked by |
|---|-------|-------|------------|
| T01 | [#1](https://github.com/bent70144-cpug/forgeforms/issues/1) | M0: Monorepo scaffold, tooling, CI, local docker env | — (frontier) |
| T02 | [#2](https://github.com/bent70144-cpug/forgeforms/issues/2) | M0: Shared kernel (Ctx/Result/AppError/IDs/logger) + Drizzle pipeline + identity schema | [#1](https://github.com/bent70144-cpug/forgeforms/issues/1) |
| T03 | [#3](https://github.com/bent70144-cpug/forgeforms/issues/3) | M1: Auth core — register/login/logout + workspace auto-create + dashboard shell | [#2](https://github.com/bent70144-cpug/forgeforms/issues/2) |
| T04 | [#4](https://github.com/bent70144-cpug/forgeforms/issues/4) | M1: Tenancy hardening — roles, requireRole, RLS, tenant-scoped repositories | [#3](https://github.com/bent70144-cpug/forgeforms/issues/3) |
| T05 | [#5](https://github.com/bent70144-cpug/forgeforms/issues/5) | M1: Google OAuth + password reset + email verification | [#3](https://github.com/bent70144-cpug/forgeforms/issues/3) |
| T06 | [#6](https://github.com/bent70144-cpug/forgeforms/issues/6) | M2: Block registry + DocumentBody Zod schema + 3 proven blocks (hero, short-text, button) | [#2](https://github.com/bent70144-cpug/forgeforms/issues/2) |
| T07 | [#7](https://github.com/bent70144-cpug/forgeforms/issues/7) | M2: Documents CRUD + ops-based PATCH autosave (rev/409) + dashboard list/create | [#3](https://github.com/bent70144-cpug/forgeforms/issues/3), [#6](https://github.com/bent70144-cpug/forgeforms/issues/6) |
| T08 | [#8](https://github.com/bent70144-cpug/forgeforms/issues/8) | M2: Builder three-pane UI (palette, drag, undo/redo, theme, endings) | [#7](https://github.com/bent70144-cpug/forgeforms/issues/7) |
| T09 | [#9](https://github.com/bent70144-cpug/forgeforms/issues/9) | M2: All MVP question blocks (email, number, long-text, single/multi-select, dropdown, rating, nps) | [#6](https://github.com/bent70144-cpug/forgeforms/issues/6), [#8](https://github.com/bent70144-cpug/forgeforms/issues/8) |
| T10 | [#10](https://github.com/bent70144-cpug/forgeforms/issues/10) | M3: Publish pipeline — versions, snapshots, unpublish→410 | [#7](https://github.com/bent70144-cpug/forgeforms/issues/7) |
| T11 | [#11](https://github.com/bent70144-cpug/forgeforms/issues/11) | M3: Scroll renderer for pages/portfolios (SEO, OG, snapshot-only) | [#10](https://github.com/bent70144-cpug/forgeforms/issues/10) |
| T12 | [#12](https://github.com/bent70144-cpug/forgeforms/issues/12) | M3: Conversational renderer for forms (one-question flow, ≤120 KB bundle) | [#10](https://github.com/bent70144-cpug/forgeforms/issues/10) |
| T13 | [#13](https://github.com/bent70144-cpug/forgeforms/issues/13) | M5-core: Logic engine — compile/evaluate/lint + 40+ golden tests (pure, shared client/server) | [#6](https://github.com/bent70144-cpug/forgeforms/issues/6) |
| T14 | [#14](https://github.com/bent70144-cpug/forgeforms/issues/14) | M4: Public ingest API (start/save/complete, idempotency, honeypot, limits) | [#10](https://github.com/bent70144-cpug/forgeforms/issues/10), [#13](https://github.com/bent70144-cpug/forgeforms/issues/13) |
| T15 | [#15](https://github.com/bent70144-cpug/forgeforms/issues/15) | M4: Results UI — submissions table, detail drawer, summary charts | [#14](https://github.com/bent70144-cpug/forgeforms/issues/14) |
| T16 | [#16](https://github.com/bent70144-cpug/forgeforms/issues/16) | M4: File uploads — presign/confirm/scan, 10 MB cap, image pipeline | [#9](https://github.com/bent70144-cpug/forgeforms/issues/9), [#14](https://github.com/bent70144-cpug/forgeforms/issues/14) |
| T17 | [#17](https://github.com/bent70144-cpug/forgeforms/issues/17) | M4/M7: Background jobs — events fan-out, notification email, webhooks with signing + retries + replay | [#14](https://github.com/bent70144-cpug/forgeforms/issues/14) |
| T18 | [#18](https://github.com/bent70144-cpug/forgeforms/issues/18) | M7: CSV export job with emailed signed link | [#15](https://github.com/bent70144-cpug/forgeforms/issues/15), [#17](https://github.com/bent70144-cpug/forgeforms/issues/17) |
| T19 | [#19](https://github.com/bent70144-cpug/forgeforms/issues/19) | M7: Analytics pipeline (beacons, partitions, rollups) + Analytics tab | [#15](https://github.com/bent70144-cpug/forgeforms/issues/15) |
| T20 | [#20](https://github.com/bent70144-cpug/forgeforms/issues/20) | M5: Logic builder canvas (React Flow) + hidden fields + prefill runtime | [#8](https://github.com/bent70144-cpug/forgeforms/issues/8), [#13](https://github.com/bent70144-cpug/forgeforms/issues/13) |
| T21 | [#21](https://github.com/bent70144-cpug/forgeforms/issues/21) | M6: Remaining content blocks + image pipeline integration | [#8](https://github.com/bent70144-cpug/forgeforms/issues/8), [#12](https://github.com/bent70144-cpug/forgeforms/issues/12) |
| T22 | [#22](https://github.com/bent70144-cpug/forgeforms/issues/22) | M6: Template gallery (≥14) + embed loader (3 modes, postMessage) | [#21](https://github.com/bent70144-cpug/forgeforms/issues/21) |
| T23 | [#23](https://github.com/bent70144-cpug/forgeforms/issues/23) | M7: Billing — Stripe checkout/portal/webhooks + can() entitlements + seats | [#4](https://github.com/bent70144-cpug/forgeforms/issues/4) |
| T24 | [#24](https://github.com/bent70144-cpug/forgeforms/issues/24) | M7: Custom domain manual flow (DNS verify → route) | [#12](https://github.com/bent70144-cpug/forgeforms/issues/12), [#23](https://github.com/bent70144-cpug/forgeforms/issues/23) |
| T25 | [#25](https://github.com/bent70144-cpug/forgeforms/issues/25) | M8: API tokens + scopes + OpenAPI generated from Zod | [#4](https://github.com/bent70144-cpug/forgeforms/issues/4), [#7](https://github.com/bent70144-cpug/forgeforms/issues/7) |
| T26 | [#26](https://github.com/bent70144-cpug/forgeforms/issues/26) | M8: MCP server — 7 tools, no deletes, audit logging | [#25](https://github.com/bent70144-cpug/forgeforms/issues/25) |
| T27 | [#27](https://github.com/bent70144-cpug/forgeforms/issues/27) | M8: AI draft + edit-with-AI + monthly quota | [#25](https://github.com/bent70144-cpug/forgeforms/issues/25) |
| T28 | [#28](https://github.com/bent70144-cpug/forgeforms/issues/28) | Hardening: Accessibility (WCAG 2.1 AA) + performance budgets across all surfaces | [#11](https://github.com/bent70144-cpug/forgeforms/issues/11), [#12](https://github.com/bent70144-cpug/forgeforms/issues/12), [#15](https://github.com/bent70144-cpug/forgeforms/issues/15), [#20](https://github.com/bent70144-cpug/forgeforms/issues/20), [#21](https://github.com/bent70144-cpug/forgeforms/issues/21) |
| T29 | [#29](https://github.com/bent70144-cpug/forgeforms/issues/29) | Hardening: Security checklist (spec §17) + GDPR + launch readiness | [#16](https://github.com/bent70144-cpug/forgeforms/issues/16), [#17](https://github.com/bent70144-cpug/forgeforms/issues/17), [#22](https://github.com/bent70144-cpug/forgeforms/issues/22), [#28](https://github.com/bent70144-cpug/forgeforms/issues/28) |

## Working the graph

- **Frontier** = tickets whose blockers are all closed. Currently: T01.
- Implementer agents work one ticket per **worktree + branch** (`ticket/<nn>-<slug>`),
  merge integration tip into their branch before reporting, and never push.
- **`main` is the integration branch**: merges are done by the lead session only,
  auto-pushed to GitHub every 20 minutes (`scripts/auto-push.sh`).
- When a ticket merges to `main`, its issue is closed with a merge-comment.

## Suggested first waves

1. `T01` → 2. `T02` → 3. `T03` ∥ `T06` → 4. `T04` ∥ `T05` ∥ `T07` ∥ `T13` …
