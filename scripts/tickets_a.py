# FormForge tickets 1-15 (dependency order). Bodies reference spec.md sections at repo root.
T1 = {
    "n": 1, "slug": "monorepo-scaffold", "title": "M0: Monorepo scaffold, tooling, CI, local docker env",
    "blocked": [],
    "build": "Scaffold the pnpm-workspaces monorepo from spec §2 at repo root: `apps/web` (Next.js 15 App Router skeleton with marketing/auth/app route groups), `apps/worker` (BullMQ entry stub), `packages/{core,schema,db,renderer,blocks,ui,config}`. TypeScript strict, ESLint + Prettier presets in `packages/config`, Vitest wired. `docker-compose.yml` (Postgres 16, Redis 7, MinIO). `.env.example` exactly per spec §5 plus Zod env validation in `packages/core/src/shared/env.ts` (fail fast on boot). pino structured logging helper. GitHub Actions CI: lint, `tsc --noEmit`, unit tests, build. Ensure pnpm via corepack.",
    "accept": ["`pnpm install` then `pnpm -r typecheck && pnpm -r lint && pnpm -r test` pass from clean clone", "`docker-compose.yml` valid and references spec §5 env vars", "CI workflow files valid; a skeleton PR would be green", "env validation throws on missing SESSION_SECRET/AUTH_SECRET with clear message"],
}
T2 = {
    "n": 2, "slug": "shared-kernel-db", "title": "M0: Shared kernel (Ctx/Result/AppError/IDs/logger) + Drizzle pipeline + identity schema",
    "blocked": [1],
    "build": "Implement spec §3/§4 shared kernel in `packages/core/src/shared`: `Ctx` type, `Result<T, AppError>`, `AppError` with codes (NOT_FOUND, FORBIDDEN, VALIDATION, CONFLICT, RATE_LIMITED, PLAN_LIMIT, INTERNAL), `uuidv7()` + `shortId` prefixed base58 helpers (`doc_`, `sub_`, `ast_`), pino logger factory (requestId/workspaceId/documentId bindings, never logs secrets). In `packages/db`: Drizzle + drizzle-kit pipeline, first migration for `users`, `workspaces`, `memberships`, `api_tokens` per spec §6 (citext email, argon2id hash column, snake_case columns). Seed script stub.",
    "accept": ["Unit tests pass for Result/AppError/uuidv7/shortId (format + uniqueness + time-ordering)", "`drizzle-kit generate` produces SQL migration matching spec §6 DDL for the four tables", "logger omits keys in a denylist; unit test proves no answer/password/token fields can be logged", "ctx.now() injected clock used by a sample service (testable, no `new Date()` inside service)"],
}
T3 = {
    "n": 3, "slug": "auth-core", "title": "M1: Auth core — register/login/logout + workspace auto-create + dashboard shell",
    "blocked": [2],
    "build": "Auth.js v5 credentials provider with argon2id hashing (spec §1/§6): register, login, logout, session cookie; on signup auto-create personal workspace + owner membership (spec §21.5). App shell + empty dashboard page per spec §14.1.2 (empty state: \"No documents yet — create your first\"). Server-side validation with Zod, inline field errors, spec §4 error body shape on API routes.",
    "accept": ["Playwright e2e: sign up → dashboard → log out → log in, session persists across restart", "Wrong password shows server-side error; empty fields show native validation", "New user row + workspace + owner membership created atomically", "Sessions are httpOnly, secure in prod, sliding expiry"],
}
T4 = {
    "n": 4, "slug": "tenancy-rls", "title": "M1: Tenancy hardening — roles, requireRole, RLS, tenant-scoped repositories",
    "blocked": [3],
    "build": "Role checks (`owner|admin|editor|viewer` + `requireRole`) per spec §6/§21. Enable Postgres RLS on every tenant table with `current_setting('app.workspace_id')` policy; repository layer opens transactions with `set local app.workspace_id = ...` (spec §6 RLS note). Dedicated limited DB role for public ingest (T14 may reuse). All core services take `Ctx` and scope by `ctx.workspaceId`.",
    "accept": ["Integration test (testcontainers in CI): user in workspace A cannot read workspace B documents through ANY repository function, including with a forged document ID and with RLS enabled", "requireRole rejects viewer attempting writes with FORBIDDEN", "Migration adds RLS policies idempotently"],
}
T5 = {
    "n": 5, "slug": "oauth-recovery", "title": "M1: Google OAuth + password reset + email verification",
    "blocked": [3],
    "build": "Auth.js Google provider behind env config; login page Google button per spec §14.1. Forgot/reset password flow (token emailed via Resend React Email template, single-use, 1h expiry), email verification flow with verified-at column update, login/reset rate limiting (spec §17: rate limited). Dev email transport logs to console when RESEND_API_KEY unset.",
    "accept": ["E2E: request reset → receive token (dev transport) → set new password → log in with it", "Reset token single-use and expired after 1h (tests)", "Google login creates/links user when GOOGLE_CLIENT_ID configured; button hidden when not", "Reset/login endpoints rate limited per IP+email"],
}
T6 = {
    "n": 6, "slug": "schema-block-registry", "title": "M2: Block registry + DocumentBody Zod schema + 3 proven blocks (hero, short-text, button)",
    "blocked": [2],
    "build": "`packages/schema` per spec §7: Block/Theme/Rule/DocumentBody Zod schemas (Zod is single source of truth), schemaVersion=1. `packages/blocks` registry per spec §7.1 (BlockDef with propsSchema, defaultProps, answerSchema?, validate?, Editor, Render; import-time registry; unknown kind renders nothing, never crashes). Three reference blocks end-to-end through the pattern: `hero`, `short-text`, `button` (schema.ts, editor.tsx, render.tsx each). Content blocks never write answers; question blocks MUST define answerSchema (enforced by a registry unit test).",
    "accept": ["Golden schema tests: valid DocumentBody parses; unknown props/missing ids rejected with field-level error paths", "Registry test: question block without answerSchema fails registration", "Unknown kind in stored body renders as nothing without throwing", "The 3 blocks render valid markup from defaultProps in a render test"],
}
T7 = {
    "n": 7, "slug": "documents-crud-autosave", "title": "M2: Documents CRUD + ops-based PATCH autosave (rev/409) + dashboard list/create",
    "blocked": [3, 6],
    "build": "Migration for `documents`, `document_versions`, `snapshots` (spec §6). `documents` module service (Ctx-scoped): create (empty DocumentBody per type), get, list (cursor), duplicate, archive. `PATCH /api/v1/documents/:id` applies ops (block.insert/update/move/remove, settings.update, theme.update, ending.upsert/remove, rule.upsert/remove, meta.update) in one transaction against draft, validates result with DocumentBody, increments rev, returns 409 CONFLICT with current body when baseRev mismatched (spec §8). Dashboard: grid/list toggle, cards with status/type/updated, create modal (type + name + blank/template), spec §14.1.2. Autosave client: 500ms debounce, serialized queue, Saving/Saved indicator, recover from 409 by refetch + reapply.",
    "accept": ["Create form → edit hero → reload: exact state preserved (e2e)", "Two tabs editing: stale baseRev gets 409 with current rev+body, client recovers without data loss", "Invalid ops rejected with spec §4 error shape and field details", "Dashboard lists documents with correct badges; create modal makes the right DocumentBody per type"],
}
T8 = {
    "n": 8, "slug": "builder-ui", "title": "M2: Builder three-pane UI (palette, drag, undo/redo, theme, endings)",
    "blocked": [7],
    "build": "Builder route `/d/[docId]` per spec §14.1.3: left Blocks tree (drag reorder via dnd-kit, duplicate/delete menu) + Add-block palette (search, categories contextual to doc type); center Canvas rendering document exactly (phone/desktop toggle); right Settings panel for selection, or Document settings/Theme/Endings when nothing selected. Top bar: inline title edit, save indicator, Preview, Share, Publish button with status. Zustand+Immer editor state, client op history undo/redo 100 entries (Cmd/Ctrl+Z / Shift+Z), Delete key with undo toast, Cmd/Ctrl+K command palette (add block, go to). Optimistic mutations, saved ≤2s, zero data loss on reload.",
    "accept": ["Build a form with all currently-registered blocks using only palette+drag; reload preserves tree order and selection-independent state", "Undo/redo round-trips block insert/move/remove", "Cmd+K palette opens, filters, inserts a block", "Theme panel edits tokens/fonts/radius and canvas reflects them live"],
}
T9 = {
    "n": 9, "slug": "question-blocks", "title": "M2: All MVP question blocks (email, number, long-text, single/multi-select, dropdown, rating, nps)",
    "blocked": [6, 8],
    "build": "Blocks per spec §7.2 table (file-upload excluded — lands with uploads ticket): `email`, `number`, `long-text`, `single-select` (allowOther, randomize), `multi-select` (min/max), `dropdown` (searchable), `rating` (scale 3–10, icon), `nps` (0–10, labels). Each with props schema, answer schema + validate, editor (canvas preview + settings), server-safe render. Generic question props for all: description, required, buttonText, imageAssetId, prefillParam. Answer value shapes exactly per §7.2 (e.g. single-select → {optionId} or {other}).",
    "accept": ["Each block validates correct and wrong answers (validate + answerSchema) in unit tests", "multi-select honors min/max; rating honors scale bounds; nps clamps 0–10", "allowOther stores {other} string; randomize shuffles option order (seeded test)", "prefillParam reads URL param and prefills editor-canvas and render preview"],
}
T10 = {
    "n": 10, "slug": "publish-pipeline", "title": "M3: Publish pipeline — versions, snapshots, unpublish→410",
    "blocked": [7],
    "build": "Publish/unpublish services + `/api/v1/documents/:id/publish|unpublish` (docs:publish scope) per spec §8: full draft validation before publish; insert immutable `document_versions`; build snapshot (resolve theme→cssVars, assets→CDN URLs, compile logic via logic engine compile, sanitize rich text) and upsert `snapshots` with etag; set status/published_version_id; CDN purge hook behind interface (log/no-op impl now); return { url }. Unpublish: status→draft, purge cache keys, public URL returns 410 unavailable page. Snapshot shape exactly per spec §8 Snapshot type.",
    "accept": ["Publish a valid draft ≤10s locally (measure + record); invalid draft blocked with lint/validation errors", "Snapshot JSON matches Snapshot type; second publish creates a new version row, immutable (no update path)", "After unpublish: public route 410, snapshot cache keys purged", "Publish is idempotent-ish: re-publish with no changes returns same url, new version only when body changed"],
}
T11 = {
    "n": 11, "slug": "scroll-renderer", "title": "M3: Scroll renderer for pages/portfolios (SEO, OG, snapshot-only)",
    "blocked": [10],
    "build": "Public route `GET /p/:slug` (and `/:workspaceSlug/:docSlug` path form) per spec §10.1: server components reading ONLY the snapshot (never builder tables), rendering content blocks (hero, text, image, section, button; gallery lightbox hydrates later). SEO meta + OG tags from snapshot.settings.seo; sitemap-friendly output; branding badge per showBranding. Static-leaning output, hydrate only interactive blocks.",
    "accept": ["Published page renders correctly with the database stopped (from snapshot cache) — documented manual check", "OG/meta tags present and match document settings", "Lighthouse on published page: Performance ≥90 desktop, Accessibility ≥90 (report saved)", "Unpublished/deleted doc → 410 page, not a crash"],
}
T12 = {
    "n": 12, "slug": "conversational-renderer", "title": "M3: Conversational renderer for forms (one-question flow, ≤120 KB bundle)",
    "blocked": [10],
    "build": "Client renderer per spec §10.2: one question at a time, progress bar, up/down arrows, auto-advance on select/rating/nps <300ms, keyboard (Enter advances text; Ctrl/Cmd+Enter advances long text and choice; Shift+Enter newline), inline validation messages, welcome screen, ending screens with optional redirect, branding badge. Reads only `/api/public/snapshot/:documentId`. Bundle budget ≤120 KB gzipped INCLUDING logic engine — CI check fails over. Mobile-verified at 390×844.",
    "accept": ["Complete a published form end-to-end on 390×844 viewport (e2e)", "Auto-advance timing <300ms for instant-answer blocks (measured in e2e)", "Bundle size check enforced in CI (fails if >120KB gz)", "Keyboard flows work: Enter/Ctrl+Enter/Shift+Enter behaviors per spec", "Ending screen shows custom body and follows redirectUrl when set"],
}
T13 = {
    "n": 13, "slug": "logic-engine", "title": "M5-core: Logic engine — compile/evaluate/lint + 40+ golden tests (pure, shared client/server)",
    "blocked": [6],
    "build": "`packages/core/src/logic` per spec §9: `compile(rules, blocks) → Routing` (lint + block-indexed map) and `evaluate(routing, ctx) → {nextBlockId, variables}`. Semantics exactly per spec: default next in document order, fallback `end:<first>`; rules in array order, first full-match (AND) wins, then-actions in order; isFallback only when nothing matched; unknown goto target → default next (never crash); operand resolution @block/@var/@hidden with normalization (select→optionId, rating→number). Compile-time lint: dangling goto, rules on missing blocks, cycles with no exit, >1 fallback per scope. Zero I/O, zero framework imports; ≥40 table-driven golden cases in `logic/__tests__/cases/*.json`.",
    "accept": ["All golden cases pass: every operator, fallback, missing answers, cycle detection", "Package imports cleanly in BOTH a server (node) and client (jsdom/browser) test — single source, no dual implementations", "compile() reports each lint violation class with rule id + block id", "evaluate() never throws on malformed routing (fuzz test with broken targets)"],
}
T14 = {
    "n": 14, "slug": "ingest-api", "title": "M4: Public ingest API (start/save/complete, idempotency, honeypot, limits)",
    "blocked": [10, 13],
    "build": "Public plane endpoints per spec §10.1/§10.3: POST /api/public/submissions (start), PATCH /api/public/submissions/:token (save step), POST /api/public/submissions/:token/complete. Idempotency-Key stored in Redis 24h returning original response on replay. Per-answer validation with block answerSchema + validate; upsert only if clientTs > updated_at; complete reconciles (last client value wins) and validates required blocks on the logic path; compute next via logic engine. Honeypot `_hp` non-empty → silently mark spam. Turnstile verify when document captcha on. Limits: 60/min per-IP start, 120/min per-token save, payload ≤256KB. Usage counter increments on complete; `submission.completed` event enqueued (queue consumer may be stub until T17). Draft submissions only while status=draft; document must be published, not past closeAt, under maxSubmissions.",
    "accept": ["curl-driven e2e: start → saves → complete on a published form; submission rows + answers + variables written", "Replaying a save with the same Idempotency-Key does not duplicate data (test)", "Out-of-order step saves never overwrite a newer answer with an older one (test)", "Invalid email then corrected stores only corrected value; server rejects answers failing answerSchema even bypassing client", "Rate limits and payload cap return spec error shape; honeypot marks spam silently"],
}
T15 = {
    "n": 15, "slug": "results-ui", "title": "M4: Results UI — submissions table, detail drawer, summary charts",
    "blocked": [14],
    "build": "`/d/:docId/results` per spec §14.1.5: Submissions tab (cursor table, one column per question, \"—\" for empty, row detail drawer with timestamp/token/hidden/variables); Summary tab (per-question aggregates: distribution for choices, rating average, NPS with detractors/passives/promoters segments; charts as small dependency-free SVG components to respect bundle budget — note as SPEC-NOTE if a chart lib is added with justification). Analytics tab placeholder linking to T19. Data via `/api/v1/documents/:id/submissions|summary` (submissions:read).",
    "accept": ["Submission made in e2e appears in table within 5s (poll or revalidate)", "Aggregates match hand-computed fixture (unit + component tests)", "Detail drawer shows all stored metadata for a submission", "Empty state actionable: \"No responses yet — share your link\""],
}
