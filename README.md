# FormForge

Multi-tenant SaaS for **forms, landing pages and portfolios** built on one block-document model — author it once, publish it as a scroll page, a conversational form, or an embeddable widget.

The build spec is the source of truth: [`spec.md`](./spec.md).

## Features

- **Block editor** — 23 block kinds (content, question, layout, action families) with drag-and-drop, autosave, and full undo/redo history (`apps/web/lib/builder`).
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

## Agent workflow

- Tickets live as GitHub issues #1–#29 with blocking edges (see [`docs/tickets.md`](./docs/tickets.md)).
- Implementation happens one ticket per git worktree + branch `ticket/<nn>-<slug>`.
- `main` is the integration branch: merges are done by the lead session only.
