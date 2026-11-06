# FormForge

[![CI](https://github.com/bent70144-cpug/forgeforms/actions/workflows/ci.yml/badge.svg)](https://github.com/bent70144-cpug/forgeforms/actions/workflows/ci.yml)
[![Security audit](https://github.com/bent70144-cpug/forgeforms/actions/workflows/security-audit.yml/badge.svg)](https://github.com/bent70144-cpug/forgeforms/actions/workflows/security-audit.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![License](https://img.shields.io/badge/license-proprietary-blue)

Multi-tenant SaaS for **forms, landing pages and portfolios** built on one block-document model — author it once, publish it as a scroll page, a conversational form, or an embeddable widget.

The build spec is the source of truth: [`spec.md`](./spec.md).

## Features

- **Block editor** — 23 block kinds (content, question, layout, action families) with a three-pane WYSIWYG builder, keyboard-first reordering, op-based autosave, and full undo/redo history (`apps/web/lib/builder`).
- **Two render planes** (`packages/renderer`) — a server-rendered *scroll* plane for pages/portfolios and a client-side *conversational* plane for forms, with a strict ≤120 KB bundle budget enforced by test.
- **Conditional logic engine** (`packages/core/src/logic`) — golden-file tested compiler + evaluator (operators, combinators, gotos, defaults, URL-param prefill) with a visual React Flow canvas and lint checks for cycles, dangling and unreachable rules.
- **Submissions & results** — idempotent ingest with Turnstile support and XSS-hardened answers; results dashboard with KPI cards, trend charts, drop-off panel, NPS bars and paginated submissions table.
- **Analytics** — beacon-based event capture with daily rollups and partitioned tables.
- **Background worker** (`apps/worker`) — BullMQ jobs for email, signed webhook delivery with backoff, CSV export, image processing/scan, analytics rollup, retention purge and replay.
- **AI workbench** — AI draft & edit endpoints with per-workspace quota (`packages/core/src/ai`).
- **Auth & multi-tenancy** — Auth.js v5 (credentials + Google), argon2id hashing, rate limits, account recovery; every service call is workspace-scoped via an explicit `Ctx`, with RLS migrations in `packages/db`.
- **Custom domains** — Cloudflare for SaaS provisioning when a token is configured, manual DNS (TXT/CNAME) fallback otherwise (`docs/custom-domains.md`).
- **Billing** — Stripe Checkout + Customer Portal + webhook-driven lifecycle, plans and entitlements (`packages/core/src/billing`).
- **MCP server** (`packages/mcp`) — 7 tools (`list_documents`, `get_document`, `create_document`, `apply_ops`, `publish_document`, `list_submissions`, `summarize_responses`). There is deliberately **no delete tool** — the only mutation surface is create / apply_ops / publish.
- **Public REST API** — versioned `/api/v1` with an OpenAPI spec served at `/api/openapi.json`.
- **Embed protocol** — iframe widgets post height + completion messages to the parent page (`packages/blocks/src/shared/embed-protocol.ts`).
- **GDPR & abuse** — workspace/account deletion, retention purge, abuse reporting with staff takedown (`docs/security-checklist.md`).
- **Accessibility** — Playwright keyboard sweep, axe checks and Lighthouse CI budgets (`lighthouserc.desktop.json`, `lighthouserc.mobile.json`).

## Builder (document editor)

The builder is the in-app editor for every document type (forms first; pages and portfolios reuse it). It lives at **`/d/[docId]`** (`apps/web/app/(app)/d/[docId]`) as a three-pane workspace — blocks tree, WYSIWYG canvas rendering the same block `Render` components as the public renderer, and a settings/theme/endings panel — with a top bar (inline title, save indicator, undo/redo, preview, publish).

Everything is op-based: the UI dispatches one of 11 typed ops (`block.insert/update/move/remove`, `settings/theme/meta.update`, `ending/rule.upsert/remove`) through a single store (`apps/web/lib/builder/`), which derives exact inverse ops for undo/redo, coalesces typing bursts, and autosaves op batches (`{ baseRev, ops }`) with backoff, offline IndexedDB persistence, 409 auto-rebase and a conflict dialog. Edits are draft-only until `POST /documents/:id/publish`.

Milestones (builder build plan):

| Milestone | Scope |
|---|---|
| **B0** | Baseline audit of the builder against its spec — [`docs/builder-audit.md`](./docs/builder-audit.md) |
| **B1** | Store, ops + exact inverses, coalescing (800 ms), grouped undo, fast-check round-trip property tests |
| **B2** | Autosave batching + backoff, IndexedDB offline queue, restore prompt, 409 rebase/conflict dialog, multi-tab banner |
| **B3** | Canvas with selection chrome, insertion points, unknown-block placeholder, per-card error boundary, inline text editing |
| **B4** | Block picker (`/`, `Cmd/Ctrl+K`), keyboard reorder + move announcements, 8 s undo toast, copy/paste with re-id |
| **B5** | Settings panel (document + per-block editors), debounced text fields, slug/notify validation |
| **B6** | Theme presets with WCAG contrast badges, endings editor, sandboxed draft preview (real renderer, mock ingest) |
| **B7** | Publish gate: stable validation codes, Issues drawer with "Go to", draft-vs-published chip |
| **B8** | AI ops as one undoable group, keyboard help dialog, a11y sweep, performance budgets |

Notes: the store intentionally mirrors the spec's pinned Zustand+Immer shape as a plain React reducer (zero-dependency policy — see the audit), reordering is keyboard-first (pointer/touch drag is tracked in the audit's follow-ups), and plan gates render as static inline notes until entitlements are resolved client-side.

### Builder tests

```bash
pnpm --filter @formforge web test        # unit + component + integration (Vitest)
pnpm --filter @formforge web typecheck   # tsc --noEmit
```

End-to-end (Playwright) suites for the builder live in `apps/web/e2e/` (`builder.spec.ts`, `a11y-*.spec.ts`) with their own config and boot modes — see [`apps/web/e2e/README.md`](./apps/web/e2e/README.md) for prerequisites and run commands. The builder's detailed per-section status, known gaps and follow-ups are tracked in [`docs/builder-audit.md`](./docs/builder-audit.md); keyboard-accessibility notes are in [`docs/a11y-keyboard-sweep.md`](./docs/a11y-keyboard-sweep.md). The product-wide spec is [`spec.md`](./spec.md) (§14 UI specification; the dedicated builder spec is maintained outside this repository).

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode), Node ≥ 22 |
| Framework | Next.js 15 (App Router), React 19 |
| Package manager | pnpm (workspace) |
| Styling | Tailwind CSS 4 + shadcn/ui, CSS-variable design tokens |
| Database | PostgreSQL 16 + Drizzle ORM / drizzle-kit |
| Validation | Zod (single source of truth for block, API and form schemas) |
| Auth | Auth.js v5, argon2id |
| Queue / cache | Redis 7 + BullMQ |
| Object storage | S3-compatible (Cloudflare R2 / MinIO locally), presigned URLs |
| Email | Resend (console mailer in dev) |
| Payments | Stripe |
| Editor state | Zustand + Immer · dnd-kit · React Flow |
| Testing | Vitest (unit), Playwright (e2e), axe-core, Lighthouse CI |
| CI | GitHub Actions |

## Repository layout

```
formforge/
├─ apps/
│  ├─ web/            # Next.js app: marketing, auth, dashboard, builder,
│  │                  #   results, analytics, /p/:slug public plane,
│  │                  #   /embed embed plane, /api/v1 + /api/public
│  └─ worker/         # BullMQ worker (email, webhooks, exports, assets, purge)
├─ packages/
│  ├─ core/           # domain modules: identity, documents, logic, submissions,
│  │                  #   assets, domains, analytics, ai, billing, gdpr, integrations
│  ├─ schema/         # Zod schemas: blocks, documents, rules, API contracts
│  ├─ db/             # Drizzle schema, migrations (incl. RLS), repositories
│  ├─ blocks/         # block definitions: schema + editor + renderer per kind
│  ├─ renderer/       # public renderer bundles (scroll + conversational)
│  ├─ mcp/            # MCP server (7 tools, no destructive surface)
│  ├─ ui/             # shared UI primitives
│  └─ config/         # tsconfig / eslint presets
├─ docs/              # tickets, custom domains, security, backups, a11y
├─ docker-compose.yml # postgres 16 + redis 7 + minio (local dev)
└─ spec.md            # build specification (source of truth)
```

### Module contract

Each `packages/core/src/<module>/` exposes only its `index.ts`:

- Service functions take a `Ctx` (workspace, actor, requestId, clock) as first argument and scope every query by `ctx.workspaceId`.
- Services return `Result<T, AppError>` — no thrown errors across module boundaries.
- Side effects (email, webhooks, analytics) are enqueued, never executed inline in request handlers.

## Quickstart (local)

```bash
docker compose up -d        # postgres 16 + redis 7 + minio
cp .env.example .env        # fill in secrets as needed
pnpm install
pnpm dev                    # web (Next.js, :3000) + worker (BullMQ) in parallel
```

- Web app: <http://localhost:3000>
- MinIO console: <http://localhost:9001> (minioadmin / minioadmin)
- Postgres: `localhost:5432` (postgres / postgres, db `formforge`)
- Redis: `localhost:6379`

## Environment variables

`packages/core/src/shared/env.ts` validates the environment with Zod at boot and fails fast. Required: `DATABASE_URL`, `SESSION_SECRET`, `AUTH_SECRET` (integration keys are optional — the features that need them check for their own key at call time). See [`.env.example`](./.env.example) for the full annotated list.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` / `AUTH_SECRET` | ✅ | ≥ 32 chars each |
| `REDIS_URL` | – | default `redis://localhost:6379` |
| `NEXT_PUBLIC_APP_URL` / `PUBLIC_BASE_URL` | – | default `http://localhost:3000` |
| `LOG_LEVEL` | – | `fatal`…`trace`, default `info` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | Google OAuth |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_PUBLIC_CDN_URL` | – | uploads & assets |
| `RESEND_API_KEY` / `EMAIL_FROM` | – | transactional email (console mailer when unset) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS` | – | billing |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | – | abuse protection |
| `AI_MODEL` | – | default `claude-sonnet-4-6` |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` | – | custom-domain provisioning |
| `MAIL_FROM` / `WORKER_CONCURRENCY` | – | worker defaults `FormForge <notifications@formforge.dev>` / `5` |

## Block catalog

| Family | Kinds |
|---|---|
| Layout | `section`, `columns`, `multi-question-page` |
| Content | `hero`, `video`, `gallery`, `testimonials`, `pricing`, `faq`, `contact-links`, `projects`, `form-embed` |
| Question | `short-text`, `long-text`, `email`, `number`, `single-select`, `multi-select`, `dropdown`, `rating`, `nps`, `file-upload` |
| Action | `button` |

Each block ships a Zod `propsSchema`, builder editor and public renderer; question blocks additionally declare an `answerSchema` that ingest validates server-side.

## Scripts

```bash
pnpm dev          # run web + worker in parallel (watch mode)
pnpm build        # build all packages/apps
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # vitest across the workspace
pnpm lint         # eslint
pnpm secrets:audit # scan for leaked secrets
```

End-to-end suites live in `apps/web/e2e` (Playwright) with their own config; Lighthouse budgets are defined in `lighthouserc.desktop.json` and `lighthouserc.mobile.json`.

## Documentation

| Doc | Contents |
|---|---|
| [`docs/tickets.md`](./docs/tickets.md) | ticket index (#1–#29) with blocking edges |
| [`docs/custom-domains.md`](./docs/custom-domains.md) | custom-domain provisioning & DNS fallback |
| [`docs/security-checklist.md`](./docs/security-checklist.md) | §17 security checklist with evidence links |
| [`docs/backups-restore-runbook.md`](./docs/backups-restore-runbook.md) | backup & restore procedures |
| [`docs/a11y-keyboard-sweep.md`](./docs/a11y-keyboard-sweep.md) | keyboard accessibility sweep notes |
| [`packages/db/TENANCY.md`](./packages/db/TENANCY.md) | tenancy / RLS model |
| [`apps/web/e2e/README.md`](./apps/web/e2e/README.md) | running the Playwright suites |

## Agent workflow

- Tickets live as GitHub issues #1–#29 with blocking edges (see [`docs/tickets.md`](./docs/tickets.md)).
- Implementation happens one ticket per git worktree + branch `ticket/<nn>-<slug>`.
- `main` is the integration branch: merges are done by the lead session only.
