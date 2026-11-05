# FormForge — Build Specification (spec.md)

> Implementation-ready spec for building FormForge: a multi-tenant SaaS for **forms, landing pages and portfolios** on one block-document model.
> Audience: a developer or coding agent. Follow milestones in order. Every milestone ends with acceptance criteria that must pass before moving on.
> Companion: the "FormForge — SaaS System Design" doc (architecture rationale). This file is the *what to build and how*.

---

## 0. How to use this spec

1. Read sections 1–6 once (stack, layout, conventions, data model, block schema).
2. Build milestones **M0 → M8** (section 15) in order. Do not start a milestone until the previous one's acceptance criteria pass.
3. When this spec and your instinct disagree, follow the spec and leave a `// SPEC-NOTE:` comment explaining the deviation.
4. Anything marked **(Phase 2)** is out of scope until all of M0–M8 are done.
5. Keep modules decoupled: a module may only call another module through its `index.ts` public interface, never its internals or its tables.

---

## 1. Tech stack (pinned decisions)

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode), Node 22 LTS |
| Framework | Next.js 15 (App Router), React 19 |
| Package manager | pnpm |
| Styling | Tailwind CSS 4 + shadcn/ui; design tokens as CSS variables |
| Database | PostgreSQL 16 |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Validation / schemas | Zod (single source of truth for block, API and form schemas) |
| Auth | Auth.js v5 (credentials + Google) with Drizzle adapter; argon2id password hashing |
| Queue / cache | Redis + BullMQ |
| Object storage | S3-compatible (Cloudflare R2), `@aws-sdk/client-s3` + presigned URLs |
| Email | Resend (React Email templates) |
| Payments | Stripe (Checkout + Customer Portal + webhooks) |
| Editor state | Zustand + Immer |
| Drag and drop | dnd-kit |
| Logic canvas | React Flow (`@xyflow/react`) |
| Rich text | Tiptap (sanitized output) |
| Testing | Vitest (unit), Playwright (e2e), MSW (mocks) |
| Lint / format | ESLint, Prettier, `tsc --noEmit` in CI |
| CI | GitHub Actions |
| Hosting | Vercel (web), Fly.io or Railway (workers), Neon (Postgres), Upstash or Redis Cloud (Redis) |
| Edge | Cloudflare (DNS, CDN, WAF, Turnstile, Cloudflare for SaaS for custom domains) |

**Rule:** do not add a dependency that duplicates one above. New dependencies need a one-line justification in the PR description.

---

## 2. Repository layout

Single repo, single Next.js app, workers in the same repo.

```
formforge/
├─ apps/
│  ├─ web/                      # Next.js app (authoring + public plane)
│  │  ├─ app/
│  │  │  ├─ (marketing)/        # landing, pricing, templates
│  │  │  ├─ (auth)/             # login, register, reset
│  │  │  ├─ (app)/              # authenticated app
│  │  │  │  ├─ dashboard/
│  │  │  │  ├─ d/[docId]/       # builder, results, share, settings
│  │  │  │  └─ settings/        # workspace, billing, tokens
│  │  │  ├─ p/[slug]/           # public render route (path-based)
│  │  │  ├─ _host/[...path]/    # public render for custom domains (middleware rewrite)
│  │  │  └─ api/
│  │  │     ├─ v1/              # authenticated REST API
│  │  │     ├─ public/          # ingest, beacons, uploads (unauthenticated)
│  │  │     └─ webhooks/        # inbound (Stripe)
│  │  ├─ middleware.ts          # host → document routing, auth gate
│  │  └─ components/
│  └─ worker/                   # BullMQ worker entrypoint
├─ packages/
│  ├─ core/                     # domain modules (see §3)
│  │  └─ src/
│  │     ├─ identity/ tenancy/ billing/ documents/ rendering/
│  │     ├─ logic/ submissions/ assets/ domains/ integrations/
│  │     ├─ analytics/ ai/ admin/
│  │     └─ shared/             # errors, ids, result types, logger, clock
│  ├─ schema/                   # Zod schemas: blocks, documents, rules, api
│  ├─ db/                       # drizzle schema, migrations, repositories
│  ├─ renderer/                 # public renderer bundles (scroll + conversational)
│  ├─ blocks/                   # block definitions: schema + editor + renderer per kind
│  ├─ ui/                       # shared UI primitives
│  └─ config/                   # tsconfig, eslint presets
├─ e2e/                         # Playwright tests
├─ .env.example
├─ docker-compose.yml           # postgres, redis, minio (local)
└─ spec.md
```

### 3. Module contract

Each module in `packages/core/src/<module>/` exposes only `index.ts` with:
- **Service functions** (`createDocument`, `publishDocument`, ...) taking a `Ctx` as first argument.
- **Types** and **error classes**.

```ts
// packages/core/src/shared/ctx.ts
export type Ctx = {
  workspaceId: string;
  actor: { type: "user" | "token" | "mcp" | "system"; id: string };
  requestId: string;
  now: () => Date;
};
```

Rules:
- Every service function that touches tenant data **requires** a `Ctx` and scopes queries by `ctx.workspaceId`. A function without a `Ctx` cannot read tenant tables.
- Services return `Result<T, AppError>` (no thrown errors across module boundaries except for programmer errors).
- Repositories live in `packages/db`; only the owning module imports its repositories.
- Side effects (email, webhooks, analytics) are enqueued, never executed inline in request handlers.

---

## 4. Conventions

**IDs:** UUIDv7, generated in the app (`uuidv7()`), stored as `uuid`. Public IDs in URLs use a prefix + base58 short form (`doc_…`, `sub_…`, `ast_…`) produced by a `shortId` helper in `shared/ids.ts`. Never expose sequential IDs.

**Time:** stored as `timestamptz` in UTC. Use the injected `ctx.now()`, never `new Date()` inside services (testability).

**Errors:** one `AppError` class with `code` (`NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`, `PLAN_LIMIT`, `INTERNAL`), `message`, `details`. API maps codes to HTTP status (404, 403, 422, 409, 429, 402, 500).

**API error body:**
```json
{ "error": { "code": "VALIDATION", "message": "Invalid input", "details": [{ "path": "blocks[2].props.title", "message": "Required" }] } }
```

**Pagination:** cursor-based. `?limit=50&cursor=<opaque>` → `{ data: [...], nextCursor: string | null }`.

**Idempotency:** mutating public endpoints accept `Idempotency-Key`. Keys stored in Redis for 24h; a repeated key returns the original response.

**Logging:** structured JSON (`pino`), always include `requestId`, `workspaceId`, `documentId` when known. Never log answer values, passwords, tokens.

**Feature gating:** one function only: `can(workspaceId, capability): Promise<boolean>` in `billing`. No inline plan checks anywhere else.

**Naming:** files `kebab-case.ts`, React components `PascalCase.tsx`, DB columns `snake_case`, TS fields `camelCase` (Drizzle mapping).

---

## 5. Environment variables (`.env.example`)

```
# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000        # used for share links
SESSION_SECRET=
# Database / cache
DATABASE_URL=postgres://postgres:postgres@localhost:5432/formforge
REDIS_URL=redis://localhost:6379
# Auth
AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Storage
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_BUCKET=formforge
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_CDN_URL=http://localhost:9000/formforge
# Email
RESEND_API_KEY=
EMAIL_FROM="FormForge <no-reply@example.com>"
# Billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=
STRIPE_PRICE_BUSINESS=
# Abuse
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
# AI (Phase M8)
ANTHROPIC_API_KEY=
AI_MODEL=claude-sonnet-4-6
# Edge / domains (Phase 2)
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
```

Fail fast on boot: validate env with Zod in `packages/core/src/shared/env.ts`.

---

## 6. Data model

Drizzle schema in `packages/db/src/schema/`. Shown here as SQL for clarity. All tenant tables include `workspace_id uuid not null references workspaces(id) on delete cascade`.

```sql
-- identity & tenancy
create table users (
  id uuid primary key,
  email citext unique not null,
  name text,
  password_hash text,
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key,
  name text not null,
  slug text unique not null,
  plan text not null default 'free',            -- free | pro | business
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

create table memberships (
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role text not null,                            -- owner | admin | editor | viewer
  primary key (workspace_id, user_id)
);

create table api_tokens (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  token_hash text not null unique,               -- sha256; plaintext shown once
  scopes text[] not null,                        -- docs:read docs:write docs:publish submissions:read
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- documents
create table documents (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null,                            -- form | page | portfolio
  title text not null,
  slug text not null,                            -- unique per workspace
  status text not null default 'draft',          -- draft | published | archived
  rev integer not null default 0,                -- optimistic concurrency
  draft jsonb not null,                          -- current working body (DocumentBody)
  published_version_id uuid,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index on documents (workspace_id, updated_at desc);

create table document_versions (
  id uuid primary key,
  document_id uuid not null references documents(id) on delete cascade,
  workspace_id uuid not null,
  schema_version integer not null,
  body jsonb not null,                           -- immutable
  created_by uuid,
  created_at timestamptz not null default now()
);

create table snapshots (
  document_id uuid primary key references documents(id) on delete cascade,
  version_id uuid not null references document_versions(id),
  rendered jsonb not null,                       -- resolved theme, assets, compiled logic
  etag text not null,
  built_at timestamptz not null default now()
);

-- submissions
create table submissions (
  id uuid primary key,
  workspace_id uuid not null,
  document_id uuid not null references documents(id) on delete cascade,
  version_id uuid not null,                      -- version answered
  status text not null default 'draft',          -- draft | completed | spam
  public_token text not null unique,
  variables jsonb not null default '{}',         -- logic variables (score, price)
  hidden jsonb not null default '{}',            -- hidden fields / UTM
  meta jsonb not null default '{}',              -- device, country, referrer (if allowed)
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on submissions (document_id, completed_at desc);

create table answers (
  submission_id uuid references submissions(id) on delete cascade,
  block_id text not null,
  value jsonb,
  updated_at timestamptz not null,
  primary key (submission_id, block_id)
);

-- assets
create table assets (
  id uuid primary key,
  workspace_id uuid not null,
  key text not null,
  mime text not null,
  size_bytes bigint not null,
  purpose text not null,                         -- media | upload
  scan_status text not null default 'pending',   -- pending | clean | infected | skipped
  created_at timestamptz not null default now()
);

-- integrations
create table webhooks (
  id uuid primary key,
  workspace_id uuid not null,
  document_id uuid references documents(id) on delete cascade,  -- null = workspace-wide
  url text not null,
  secret text not null,
  events text[] not null default '{submission.completed}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  id uuid primary key,
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event_id uuid not null,
  attempt integer not null,
  status_code integer,
  ok boolean not null,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);

-- analytics
create table analytics_events (
  document_id uuid not null,
  ts timestamptz not null,
  type text not null,                            -- view | start | question_view | question_pass | complete
  session_hash text not null,
  block_id text,
  props jsonb
) partition by range (ts);

create table analytics_daily (
  document_id uuid not null,
  day date not null,
  views integer not null default 0,
  starts integer not null default 0,
  completes integer not null default 0,
  primary key (document_id, day)
);

-- misc
create table usage_counters (
  workspace_id uuid not null,
  period text not null,                          -- e.g. 2026-11
  metric text not null,
  value bigint not null default 0,
  primary key (workspace_id, period, metric)
);

create table audit_log (
  id uuid primary key,
  workspace_id uuid not null,
  actor_type text not null,
  actor_id text,
  action text not null,
  target text,
  created_at timestamptz not null default now()
);
```

**Row-level security:** enable RLS on every tenant table with a policy on `current_setting('app.workspace_id')`. The repository layer sets it per transaction (`set local app.workspace_id = ...`). Public ingest uses a dedicated DB role limited to `submissions`, `answers`, `assets` inserts/updates for published documents.

---

## 7. Block document schema (Zod)

Defined in `packages/schema/src/document.ts`. This is the heart of the product.

```ts
import { z } from "zod";

export const BlockBase = z.object({
  id: z.string().min(1),          // stable, nanoid(10)
  kind: z.string(),
  props: z.record(z.unknown()),   // validated by the kind's own schema
  children: z.array(z.lazy(() => Block)).optional(),
  hidden: z.boolean().optional(),
});
export type Block = z.infer<typeof BlockBase>;
export const Block: z.ZodType<Block> = BlockBase;

export const Theme = z.object({
  tokens: z.record(z.string()),    // e.g. "color.bg": "#fbf9f4"
  fontHeading: z.string().default("Inter"),
  fontBody: z.string().default("Inter"),
  radius: z.enum(["none", "sm", "md", "lg", "full"]).default("md"),
});

export const Rule = z.object({
  id: z.string(),
  scope: z.string(),               // blockId this rule runs after, or "start"
  when: z.array(z.object({
    left: z.string(),              // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
    op: z.enum(["eq","neq","gt","gte","lt","lte","contains","isEmpty","matches"]),
    right: z.unknown().optional(),
  })),
  then: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("goto"), target: z.string() }),       // blockId | "end:<endingId>"
    z.object({ type: z.literal("set"), var: z.string(), value: z.unknown() }),
  ])),
  isFallback: z.boolean().default(false),   // "in all other cases"
});

export const DocumentBody = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(["form", "page", "portfolio"]),
  theme: Theme,
  settings: z.object({
    seo: z.object({ title: z.string().optional(), description: z.string().optional(), ogImageAssetId: z.string().optional() }).default({}),
    locale: z.string().default("en"),
    progressBar: z.boolean().default(true),
    autoAdvance: z.boolean().default(true),
    showBranding: z.boolean().default(true),
    captcha: z.boolean().default(false),
    closeAt: z.string().datetime().optional(),
    maxSubmissions: z.number().int().positive().optional(),
    notifyEmails: z.array(z.string().email()).default([]),
  }),
  blocks: z.array(Block),
  endings: z.array(z.object({ id: z.string(), title: z.string(), body: z.string().optional(), redirectUrl: z.string().url().optional() })).default([]),
  logic: z.object({ rules: z.array(Rule) }).default({ rules: [] }),
});
export type DocumentBody = z.infer<typeof DocumentBody>;
```

### 7.1 Block registry

Each block lives in `packages/blocks/src/<kind>/` with four files:

```
index.ts      # registers the block
schema.ts     # Zod schema for props (and answer value, for question blocks)
editor.tsx    # builder UI: canvas preview + settings panel
render.tsx    # public renderer component (server-safe; client only if interactive)
```

```ts
export type BlockDef<P, A = never> = {
  kind: string;
  family: "content" | "question" | "action" | "layout";
  label: string;
  icon: string;
  propsSchema: z.ZodType<P>;
  defaultProps: () => P;
  answerSchema?: z.ZodType<A>;                         // question blocks only
  validate?: (answer: A, props: P) => string | null;   // server-side + client-side
  Editor: React.FC<EditorProps<P>>;
  Render: React.FC<RenderProps<P, A>>;
};
```

**Registry rules**
- Registry is built at import time; unknown `kind` in a stored document renders as nothing (never crashes).
- Question blocks MUST define `answerSchema`; ingest validates every answer against it.
- Content blocks never store anything in `answers`.

### 7.2 MVP block catalog

| Family | Kind | Props (summary) | Answer value |
|---|---|---|---|
| Content | `hero` | title, subtitle, imageAssetId, cta{label,href} | — |
| Content | `text` | richText (Tiptap JSON → sanitized HTML) | — |
| Content | `image` | assetId, alt, caption | — |
| Content | `gallery` | assetIds[], layout(grid/masonry), columns | — |
| Content | `video` | url (YouTube/Vimeo allowlist) | — |
| Content | `testimonials` | items[{quote,name,role,avatarAssetId}] | — |
| Content | `faq` | items[{q,a}] | — |
| Content | `pricing` | tiers[{name,price,features[],cta}] | — |
| Content | `projects` (portfolio) | items[{title,description,coverAssetId,link,tags[]}] | — |
| Content | `contact-links` | links[{type,url}] | — |
| Layout | `section` | background, padding, children | — |
| Layout | `columns` | count(2-4), children | — |
| Layout | `multi-question-page` | children (question blocks) | map of child answers |
| Action | `button` | label, href, style | — |
| Action | `form-embed` | documentId (type=form) | — |
| Question | `short-text` | label, placeholder, required, maxLength | `string` |
| Question | `long-text` | label, placeholder, required, maxLength | `string` |
| Question | `email` | label, required | `string` (email) |
| Question | `number` | label, required, min, max | `number` |
| Question | `single-select` | label, options[{id,label}], allowOther, randomize | `{ optionId } or { other: string }` |
| Question | `multi-select` | label, options[], min, max | `{ optionIds: string[] }` |
| Question | `dropdown` | label, options[], searchable | `{ optionId }` |
| Question | `rating` | label, scale(3-10), icon | `number` |
| Question | `nps` | label, leftLabel, rightLabel | `number` 0–10 |
| Question | `file-upload` | label, accept[], maxSizeMb(≤10), maxFiles | `{ assetIds: string[] }` |

Every question block also supports generic props: `description`, `required`, `buttonText`, `imageAssetId`, `prefillParam` (URL param name).

Not in MVP **(Phase 2)**: phone, date, URL, address, matrix, ranking, opinion scale, slider, signature, payment, scheduler.

---

## 8. Document lifecycle

```
create → draft ─(edit, autosave)→ draft ─(publish)→ published ─(edit)→ published + unpublished changes
                                                    └─(unpublish)→ draft
```

**Autosave (authoring)**
- Client sends patches to `PATCH /api/v1/documents/:id` with `{ baseRev, ops: Op[] }`.
- Ops: `block.insert {parentId?, index, block}`, `block.update {id, props}`, `block.move {id, parentId?, index}`, `block.remove {id}`, `settings.update {…}`, `theme.update {…}`, `ending.upsert/remove`, `rule.upsert/remove`, `meta.update {title, slug}`.
- Server applies ops in one transaction against `documents.draft`, validates the result with `DocumentBody`, increments `rev`. If `baseRev !== rev` → `409 CONFLICT` with the current `rev` and body.
- Client debounce 500 ms; queue serializes requests; show "Saving…" / "Saved" indicator; recover from 409 by refetching and re-applying unsent ops where possible.

**Publish**
1. Validate `draft` fully (`DocumentBody`, lint rules, required assets exist, form-embed targets exist and are published).
2. Insert immutable `document_versions` row with the body.
3. Build snapshot (resolve theme → CSS variable map, asset ids → CDN URLs, compile logic into block-indexed routing map, sanitize rich text) and upsert `snapshots`.
4. Update `documents.status = 'published'`, `published_version_id`.
5. Purge CDN cache by tag `doc:<id>`; update KV routing entry.
6. Return `{ url }`. Target total latency p95 under 10 s.

**Unpublish:** set `status='draft'`, delete snapshot cache keys; public URL returns the "unavailable" page (HTTP 410).

**Snapshot shape** (`snapshots.rendered`):
```ts
type Snapshot = {
  documentId: string; versionId: string; type: "form"|"page"|"portfolio";
  title: string; seo: {...}; locale: string;
  cssVars: Record<string,string>;
  blocks: Block[];                       // sanitized, asset URLs resolved
  endings: Ending[];
  routing: Record<string, RouteNode>;    // compiled logic, keyed by blockId
  settings: { progressBar: boolean; autoAdvance: boolean; showBranding: boolean; captcha: boolean; closeAt?: string };
};
```

---

## 9. Logic engine (`packages/core/src/logic`)

Pure functions, zero I/O, no framework imports. Used by the renderer (client), ingest validation (server) and tests.

```ts
export function compile(rules: Rule[], blocks: Block[]): Routing;   // lint + index

export function evaluate(
  routing: Routing,
  ctx: { answers: Record<string, unknown>; variables: Record<string, unknown>; hidden: Record<string, unknown>; currentBlockId: string }
): { nextBlockId: string | `end:${string}`; variables: Record<string, unknown> };
```

**Semantics**
- Default next = the next question block in document order; after the last, `end:<first ending>`.
- Rules scoped to `currentBlockId` are evaluated in array order; first rule whose `when` conditions all pass (AND) wins; its `then` actions run in order.
- A rule with `isFallback: true` has empty `when` and runs only if no other rule matched.
- Unknown `goto` target at runtime → fall back to default next (never crash).
- Operand resolution: `@block:<id>` → answer value (normalized: select → optionId, rating → number), `@var:<name>`, `@hidden:<name>`.

**Compile-time lint (blocks save/publish on error):** dangling `goto` targets, rules scoped to missing blocks, goto cycles with no exit, more than one fallback per scope.

**Tests:** table-driven golden cases in `logic/__tests__/cases/*.json`, at least 40 cases covering every operator, fallback, missing answers, and cycle detection.

---

## 10. Public plane

### 10.1 Routes

| Route | Purpose |
|---|---|
| `GET /p/:slug` | Public render by path (workspace slug in subdomain or path: `/p/:workspaceSlug/:docSlug`) |
| `GET *` on custom hostname | Middleware maps `Host` → `documentId` via routing table, rewrites to `_host` |
| `GET /api/public/snapshot/:documentId` | JSON snapshot for the conversational renderer (CDN cached) |
| `POST /api/public/submissions` | Start a submission |
| `PATCH /api/public/submissions/:token` | Save step answers |
| `POST /api/public/submissions/:token/complete` | Finalize |
| `POST /api/public/uploads/presign` | Presigned PUT for file answers |
| `POST /api/public/uploads/confirm` | Confirm upload, queue scan |
| `POST /api/public/a` | Analytics beacon batch |

### 10.2 Renderers

- **Scroll renderer** (pages, portfolios): server components. Static HTML, hydrate only interactive blocks (`form-embed`, gallery lightbox).
- **Conversational renderer** (forms): client bundle, one question at a time, progress bar, up/down arrows, auto-advance on select/rating/NPS (under 300 ms), keyboard: Enter advances text, Ctrl/Cmd+Enter advances long text and choice, Shift+Enter newline.
- Bundle budget: conversational renderer ≤ 120 KB gzipped including the logic engine. CI fails if exceeded.
- Both renderers read **only** the snapshot; they never query builder tables.
- `form-embed` renders the target form's conversational renderer inside an isolated iframe (`/embed/:documentId`) with a `postMessage` API: `{ type: "ff:height", value }`, `{ type: "ff:complete", submissionToken }`.

### 10.3 Ingest contract

**Start** — `POST /api/public/submissions`
```json
{ "documentId": "doc_…", "hidden": { "utm_source": "x" }, "turnstileToken": "…" }
```
→ `201 { "token": "sub_…", "versionId": "…" }`
Rules: document must be `published`, not past `closeAt`, under `maxSubmissions`; verify Turnstile when `captcha` is on; create `draft` submission; emit `start` event.

**Save step** — `PATCH /api/public/submissions/:token`, header `Idempotency-Key`
```json
{ "answers": [{ "blockId": "b3", "value": "ana@example.com", "clientTs": "2026-11-06T10:00:00.000Z" }] }
```
→ `200 { "next": "b4", "variables": { … } }`
Rules: validate each answer with the block's `answerSchema` + `validate`; upsert per answer only if `clientTs > answers.updated_at`; compute `next` via the logic engine; reject when the submission is not `draft`.

**Complete** — `POST /api/public/submissions/:token/complete`
```json
{ "answers": [ /* client's final value for every touched block */ ] }
```
→ `200 { "endingId": "end_1", "redirectUrl": null }`
Rules: reconcile (upsert all provided answers, last client value wins), validate required blocks reachable by the logic path, set `completed`, emit `complete`, enqueue `submission.completed` event, increment usage counter. Idempotent: a second call returns the same result.

**Limits:** per-IP 60 requests/min on start, per-token 120/min on save; payload ≤ 256 KB; honeypot field `_hp` must be empty (silently mark `spam` if not).

---

## 11. Authenticated API (`/api/v1`)

All routes require session cookie **or** `Authorization: Bearer <token>`. Workspace comes from the session's active workspace or the token's workspace. Validate with Zod; respond with the error shape in §4.

| Method & path | Scope | Description |
|---|---|---|
| `GET /documents` | docs:read | List (filters: type, status, q) |
| `POST /documents` | docs:write | Create `{type, title, templateId?}` |
| `GET /documents/:id` | docs:read | Get draft + metadata |
| `PATCH /documents/:id` | docs:write | Apply ops with `baseRev` |
| `POST /documents/:id/duplicate` | docs:write | Copy |
| `DELETE /documents/:id` | docs:write | Soft-delete (archive) |
| `POST /documents/:id/publish` | docs:publish | Publish |
| `POST /documents/:id/unpublish` | docs:publish | Unpublish |
| `GET /documents/:id/versions` | docs:read | History |
| `POST /documents/:id/versions/:vid/restore` | docs:write | Restore as draft |
| `GET /documents/:id/submissions` | submissions:read | Table data (cursor) |
| `GET /documents/:id/submissions/:sid` | submissions:read | Detail |
| `GET /documents/:id/summary` | submissions:read | Per-question aggregates + NPS |
| `POST /documents/:id/exports` | submissions:read | Queue CSV export `{from?, to?}` |
| `GET /documents/:id/analytics` | docs:read | KPIs + trend |
| `GET/POST/PATCH/DELETE /documents/:id/webhooks` | docs:write | Manage |
| `GET /webhooks/:id/deliveries` | docs:read | Delivery log |
| `POST /webhooks/:id/deliveries/:did/replay` | docs:write | Replay |
| `POST /assets/presign`, `POST /assets/confirm` | docs:write | Media upload |
| `GET/POST/DELETE /tokens` | session only | Manage API tokens |
| `GET /workspace`, `PATCH /workspace`, members CRUD | session only | Tenancy |
| `POST /billing/checkout`, `POST /billing/portal` | session only | Stripe |

Rate limit: 600 req/min per token, 300 per session.

---

## 12. Background jobs (BullMQ)

| Queue | Job | Trigger | Behavior |
|---|---|---|---|
| `events` | `submission.completed` | ingest complete | Fan-out: notification email, webhooks, analytics |
| `email` | `send-notification`, `send-export-ready`, `send-verify`, `send-reset` | various | Resend; retry 5× exponential |
| `webhooks` | `deliver` | fan-out / replay | POST with signature; backoff 1m, 5m, 30m, 2h, 12h; log every attempt; disable after 10 consecutive failures |
| `exports` | `csv-export` | API | Stream rows by cursor to S3, email signed link (7-day expiry) |
| `assets` | `scan`, `process-image` | upload confirm | ClamAV scan (or `skipped` in dev); WebP/AVIF variants |
| `analytics` | `ingest-batch`, `rollup` | beacon / cron | Insert events; rollup daily (hourly for today) |
| `maintenance` | `reap-orphans`, `purge-old-deliveries`, `create-partitions` | cron | Housekeeping |

**Webhook payload & signature**
```json
{ "id": "evt_…", "type": "submission.completed", "occurredAt": "…", "workspaceId": "…", "documentId": "…",
  "data": { "submissionId": "…", "answers": { "<blockId>": { "label": "Email", "value": "…" } }, "hidden": {}, "variables": {} } }
```
Header: `X-FormForge-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>`. Consumers reject if timestamp older than 5 minutes.

---

## 13. Billing and entitlements

| Capability | Free | Pro | Business |
|---|---|---|---|
| Documents | unlimited | unlimited | unlimited |
| Submissions | unlimited (fair use) | unlimited | unlimited |
| File upload size | 10 MB | 10 MB | 50 MB |
| Remove branding | no | yes | yes |
| Custom domain | no | 1 | 5 |
| Team seats | 1 | 3 | 10 |
| Advanced analytics (drop-off) | no | yes | yes |
| Partial submissions | no | yes | yes |
| Webhooks | yes | yes | yes |

**Implementation**
- `billing.can(workspaceId, capability)` reads a cached `entitlements` object derived from `workspaces.plan`.
- Stripe webhook (`/api/webhooks/stripe`) handles `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`; verifies signature; updates `workspaces.plan`; is idempotent by event id.
- Over-limit actions throw `PLAN_LIMIT` (HTTP 402) with `{ capability, requiredPlan }`; UI shows an upgrade prompt. **Never put upgrade buttons inside editing surfaces**; show them only in settings and on the error response.
- Fair use: soft alert at 100k submissions/month per workspace; admin review, no automatic cutoff.

---

## 14. UI specification

### 14.1 Screens

1. **Auth:** login, register, forgot/reset password, Google button, password visibility toggle, inline server errors.
2. **Dashboard:** grid/list toggle; cards with title, type badge, status, submissions count, updated time; quick actions (open, copy link, duplicate, archive); "New" button → create modal (type: Form / Page / Portfolio, start from template or blank, name).
3. **Builder** (`/d/:id`): three panes.
   - Left: **Blocks** list (tree, drag to reorder, duplicate/delete menu) + "Add block" palette (search + categories; contextual: question blocks for forms, content blocks for pages/portfolios).
   - Center: **Canvas** showing the document exactly as rendered (phone/desktop toggle).
   - Right: **Settings** panel for the selected block, or Document settings / Theme / Endings when nothing is selected.
   - Top bar: title (inline edit), save indicator, Preview, Share, Publish button with status.
4. **Logic builder** (`/d/:id/logic`): React Flow canvas; nodes = start, question blocks, endings; edges = default flow; clicking a node opens a drawer to add/edit rules (IF conditions with AND, THEN goto/set, "in all other cases"). Autosave with "Saved" chip.
5. **Results** (`/d/:id/results`): tabs Submissions (table, one column per question, "—" for empty, detail drawer with timestamp and token), Summary (per-question charts, rating average, NPS with segments), Analytics (views, starts, completes, completion rate, 30-day trend).
6. **Share:** public link with copy, embed code (standard div + loader script, popup, full page; JS and iframe), QR (Phase 2).
7. **Integrate:** notification emails, webhooks (create, secret reveal once, delivery log, replay).
8. **Settings:** workspace, members, billing, API tokens.
9. **Templates gallery:** at least 6 forms, 4 landing pages, 4 portfolios (original content, stored as `DocumentBody` JSON files in `packages/core/src/documents/templates/`).

### 14.2 Interaction rules

- Every mutation is optimistic; show saved state within 2 s; zero data loss on reload.
- Keyboard: `Cmd/Ctrl+K` command palette (add block, go to), `Delete` removes selected block (with undo toast), `Cmd/Ctrl+Z / Shift+Z` undo/redo (client history of ops, 100 entries).
- Empty states are actionable ("No responses yet — share your link").
- Destructive actions use an undo toast where possible, a confirm dialog otherwise.
- Loading: skeletons, never blank screens.

### 14.3 Design tokens

Define in `packages/ui/tokens.css`; both builder and renderers consume CSS variables (`--ff-bg`, `--ff-fg`, `--ff-primary`, `--ff-primary-fg`, `--ff-muted`, `--ff-border`, `--ff-radius`, `--ff-font-heading`, `--ff-font-body`). Support light and dark for the app; documents use their own theme.

### 14.4 Accessibility (release gate)

WCAG 2.1 AA: every interactive element keyboard reachable with visible focus; labels on all inputs; ARIA live region announcing validation errors and question changes in the conversational renderer; color contrast ≥ 4.5:1; reduced-motion respected; axe-core run in Playwright with zero critical violations.

---

## 15. Milestones

Each milestone lists **Build**, **Acceptance**. A milestone is done only when all acceptance items pass in CI or a recorded manual check.

### M0 — Project foundation (week 1)
**Build**
- Monorepo, tooling, `docker-compose.yml` (Postgres, Redis, MinIO), `.env.example`, env validation, logging, error types, `Ctx`, `Result`, ID helpers.
- Drizzle setup, migration pipeline, seed script, CI (lint, typecheck, unit tests, build).
**Acceptance**
- `pnpm dev` starts web + worker locally with one command after `docker compose up`.
- CI green on an empty PR; migrations apply on a fresh DB.

### M1 — Identity and tenancy (weeks 1–2)
**Build**
- Register/login/logout, Google OAuth, password reset, email verification, sessions.
- Workspace auto-created on signup; memberships; role checks (`requireRole`).
- Layout shell, dashboard (empty), workspace settings stub.
- RLS policies and the repository tenant-scoping helper.
**Acceptance**
- E2E: sign up → dashboard → log out → log in, persistent session.
- Wrong password shows a server-side error; native validation on empty fields.
- Test proving a user in workspace A cannot read workspace B documents through any repository function (including with RLS enabled and a forged ID).

### M2 — Document model and builder core (weeks 2–5)
**Build**
- `schema` package (§7), block registry, content blocks (`hero`, `text`, `image`, `section`, `button`) and question blocks (`short-text`, `long-text`, `email`, `number`, `single-select`, `dropdown`, `rating`, `nps`).
- Documents CRUD, ops-based `PATCH` with `rev`, autosave client, builder three-pane UI, add-block palette with search, drag reorder, duplicate, delete, undo/redo, theme panel (colors, fonts, radius), endings panel.
- Dashboard list/grid, create modal.
**Acceptance**
- Creating a form with all MVP question blocks, reordering, and reloading preserves exact state.
- Conflicting edits from two tabs return 409 and recover without data loss.
- Invalid `DocumentBody` (unknown prop types, missing ids) is rejected with field-level errors.
- Autosave "Saved" indicator appears within 2 s of the last change.

### M3 — Publish and public renderers (weeks 5–7)
**Build**
- Publish/unpublish pipeline, versions, snapshot builder, CDN purge hook, routing table.
- Scroll renderer (pages, portfolios) with SEO meta, OG tags, sitemap-friendly output.
- Conversational renderer for forms (progress bar, arrows, auto-advance, keyboard flows, validation messages, welcome and ending screens, branding badge).
- Mobile verification at 390×844.
**Acceptance**
- Publishing a form yields a live public URL within 10 s (p95); unpublish returns 410.
- Lighthouse on a published page: Performance ≥ 90 desktop, ≥ 85 mobile; Accessibility ≥ 90.
- Renderer bundle ≤ 120 KB gzipped (CI check).
- Public pages render with the database stopped, from cache (documented manual check).

### M4 — Submissions and responses (weeks 7–9)
**Build**
- Ingest API (start/save/complete) with idempotency, validation, reconciliation, honeypot, Turnstile, rate limits.
- Results UI: submissions table, detail drawer, summary tab (charts, NPS segments).
- Notification email job.
- File upload block: presign, confirm, scan, signed downloads, 10 MB cap.
**Acceptance**
- E2E: complete a 10-question form including a 10 MB upload; response visible in the table within 5 s.
- Replaying the same save request with the same `Idempotency-Key` does not duplicate data.
- Out-of-order step saves never overwrite a newer answer with an older one (test).
- An invalid email entered then corrected stores only the corrected value.
- Server rejects answers that fail `answerSchema` even when the client is bypassed.

### M5 — Logic builder (weeks 9–11)
**Build**
- Logic engine (§9) with compile lint and 40+ golden tests.
- React Flow logic builder with rule drawer, fallback, multiple endings, hidden fields (UTM capture), per-question prefill via URL param.
- Runtime integration in the conversational renderer and ingest.
**Acceptance**
- "If NPS ≤ 6 go to ending B, otherwise ending A" works in builder and runtime.
- Dangling target blocks publish with a clear error.
- Hidden fields captured end-to-end and shown in results.
- Same engine package is used on client and server (single import, verified by a test).

### M6 — Portfolio, pages and embeds (weeks 10–12, parallel with M5)
**Build**
- Remaining content blocks (`gallery`, `video`, `testimonials`, `faq`, `pricing`, `projects`, `contact-links`, `columns`, `form-embed`).
- Image pipeline (variants, responsive `srcset`, blur placeholder).
- Template gallery (≥ 14 templates), "Use template" flow.
- Embed loader (`/embed.v1.js`), standard/popup/full-page modes, iframe `postMessage` events.
**Acceptance**
- A portfolio with projects, gallery and an embedded inquiry form can be built from a template in under 5 minutes (usability check).
- Submitting the embedded form creates a submission on the form document, visible in its Results.
- Embed works on a plain HTML test page and resizes its height automatically.

### M7 — Integrations, analytics, billing (weeks 12–15)
**Build**
- Webhooks with signing, delivery log, replay; CSV export job with emailed link.
- Analytics pipeline (beacons, partitions, rollups) and Analytics tab; drop-off per question gated by `can(...)`.
- Stripe checkout/portal/webhooks, entitlements, plan limits, seats and invitations.
- Custom domain **manual** flow: add hostname, show DNS instructions, verify, route (Cloudflare for SaaS).
**Acceptance**
- Webhook endpoint receiving a failing response is retried on schedule and visible in the log; replay works.
- 10k-row CSV export arrives by email within 5 minutes.
- Analytics tab and Submissions count always agree (single-source test).
- Upgrading via Stripe test mode unlocks capabilities within 30 s; downgrade re-locks them.
- A custom hostname serves the published document over HTTPS.

### M8 — Public API, MCP and AI (weeks 15–20)
**Build**
- API tokens UI + scopes, OpenAPI document generated from Zod schemas.
- MCP server exposing: `list_documents`, `get_document`, `create_document`, `apply_ops`, `publish_document`, `list_submissions`, `summarize_responses`. **No delete tools.**
- AI: prompt → `DocumentBody` draft (strict schema, one repair attempt), "edit with AI" ops generation, per-workspace monthly quota.
**Acceptance**
- OpenAPI spec validates; a sample script creates, publishes and reads a form using only a token.
- AI draft always passes `DocumentBody` validation or returns a clear failure; never writes without user confirmation.
- Tool calls from MCP appear in `audit_log` with `actor_type='mcp'`; cross-workspace IDs are rejected.

---

## 16. Testing strategy

| Layer | Tool | What must be covered |
|---|---|---|
| Unit | Vitest | Logic engine (golden cases), block answer schemas, ops application, snapshot builder, entitlement function, ID helpers |
| Integration | Vitest + real Postgres/Redis (testcontainers) | Repositories + RLS, ingest flow, webhooks signing/retry, Stripe webhook idempotency |
| E2E | Playwright | Signup → build → publish → submit → view result; builder autosave/reload; logic routing; embed; mobile viewport |
| Accessibility | axe-core in Playwright | Builder, dashboard, public form, public page |
| Performance | Lighthouse CI | Public form and portfolio budgets |
| Security | Custom tests | Tenant isolation, XSS payloads in rich text and answers, upload type spoofing, rate limits |

CI rule: PRs cannot merge with failing tests, type errors, lint errors, or bundle-size regression.

---

## 17. Security checklist (verify before launch)

- [ ] All tenant tables have RLS; every repository call sets workspace context.
- [ ] Passwords hashed with argon2id; login and reset rate limited.
- [ ] API tokens stored hashed, shown once, scoped, revocable.
- [ ] Rich text sanitized on save **and** on snapshot build (allowlist); no raw HTML blocks.
- [ ] Strict CSP on public pages; user-supplied embeds only via sandboxed iframes with allowlisted hosts (YouTube, Vimeo, Calendly).
- [ ] Uploads: size cap, MIME allowlist, magic-byte check, scan before download, signed URLs only.
- [ ] Webhook secrets random 32 bytes; signature + timestamp; SSRF protection on outbound URLs (block private IP ranges, resolve DNS then connect to the resolved IP).
- [ ] Turnstile + honeypot + rate limits on ingest.
- [ ] Abuse controls: publish-time check for sensitive fields (card numbers, passwords) with warning; "Report abuse" link on every public page; admin takedown that sets a document to `archived` and purges cache.
- [ ] Secrets only in env/secret manager; no secrets in logs or client bundles.
- [ ] GDPR: workspace data export, workspace and account deletion, per-form retention setting, DPA page.
- [ ] Backups with tested restore.

---

## 18. Non-functional targets

| Area | Target |
|---|---|
| Public availability | 99.9% |
| Public page LCP (4G) | < 2 s |
| Question transition | < 300 ms (auto-advance), < 2 s p95 for server-validated steps |
| Ingest p95 | < 300 ms |
| Builder interactive | < 3 s |
| Publish → live | < 10 s p95 |
| CSV export (10k rows) | < 5 min |
| RPO / RTO (authoring) | 5 min / 1 h |

---

## 19. Out of scope for this build (Phase 2+)

Phone/date/URL/address/matrix/ranking/slider/signature/payment/scheduler blocks, Typeform and Google Forms import, Zapier/Make/Sheets/Slack/Notion integrations, QR codes, partial-submission refill links, anonymous mode, form translations, EU data residency, real-time collaboration, white-label, certified e-signatures, marketplace.

---

## 20. Definition of Done (per ticket)

1. Code merged behind a feature flag if user-visible and incomplete.
2. Unit tests for new logic; integration/e2e test for new user-facing flows.
3. Types are strict; no `any` without a `// SPEC-NOTE`.
4. Accessibility checked (keyboard + axe) for any new UI.
5. No new lint warnings; bundle budgets respected.
6. Migrations are backward compatible (expand → migrate → contract).
7. Docs updated: this spec (if behavior changed), API OpenAPI, `.env.example`.
8. Telemetry added for new critical paths (error, latency).

---

## 21. First-day task list (copy into your tracker)

1. Scaffold monorepo with pnpm workspaces; set up TypeScript, ESLint, Prettier, Vitest.
2. Add `docker-compose.yml` and `.env.example`; implement env validation.
3. Create Drizzle schema for `users`, `workspaces`, `memberships`, `documents`, `document_versions`, `snapshots`; run first migration.
4. Implement `shared` helpers: `Ctx`, `Result`, `AppError`, `uuidv7`, `shortId`, logger.
5. Implement register/login with Auth.js and workspace auto-creation.
6. Build the dashboard shell and "New document" modal (creates an empty `DocumentBody` per type).
7. Write the `DocumentBody` Zod schema and 3 block definitions (`hero`, `short-text`, `button`) end to end (schema, editor, renderer) to prove the registry pattern.
8. Open the first PR with CI green; demo: create a page, edit a hero, reload, state preserved.
