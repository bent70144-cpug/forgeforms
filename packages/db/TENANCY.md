# Tenancy & Row-Level Security (T04)

Spec §6 requires RLS on every tenant table with a policy keyed on
`current_setting('app.workspace_id')`. This note explains how it is wired and
what the runtime contract is.

## Migrations

| File | Contents |
|---|---|
| `drizzle/0002_crazy_magneto.sql` | Tenant tables: `documents`, `document_versions`, `snapshots`, `submissions`, `answers` (typed in `src/schema/tenancy.ts`) |
| `drizzle/0003_tenancy_rls.sql` | RLS policies, `formforge_app` / `formforge_ingest` roles, grants — **idempotent** (re-applying converges; `DROP POLICY IF EXISTS` + `CREATE POLICY`, no-op `ENABLE ROW LEVEL SECURITY`, roles created only when missing) |

Tables owned by later tickets (`assets`, `events`, `usage_counters`,
`audit_log`, `webhook_endpoints`, `webhook_deliveries`, `analytics_events`,
`analytics_daily`) get their policies from the conditional `DO` blocks in 0003:
they are skipped until the table exists — re-apply 0003 after their DDL lands.

`users` and `workspaces` are **not** tenant tables: users is the global login
plane; workspaces is the tenant root itself (its id **is** `app.workspace_id`).

## Roles

| Role | Purpose | Privileges |
|---|---|---|
| `formforge_app` | application plane | full CRUD on tenant tables, `SELECT/UPDATE` on `workspaces` |
| `formforge_ingest` | public ingest plane (T14 may reuse) | `SELECT` on `documents`/`snapshots` (published only, via policy), `SELECT/INSERT/UPDATE` on `submissions`/`answers` (+ `assets` when it exists). **No DELETE, no memberships/api_tokens access.** |

Both roles are `NOLOGIN` (assume-only). The migration grants membership to the
user that runs migrations (`GRANT formforge_app TO CURRENT_USER`), which in the
common setup is the same user as `DATABASE_URL`.

## The repository contract

Tenant-scoped repository code MUST go through the helpers in
`src/repositories/tenant.ts`:

```ts
import { withTenantScope } from "@formforge/db/repositories";

await withTenantScope(db, ctx.workspaceId, async (tx) => {
  // app.workspace_id is set (transaction-local) and
  // role is formforge_app → RLS binds
});
```

* `set local app.workspace_id = <ctx.workspaceId>` — the policy key.
* `set local role formforge_app` — **required even when the connection user is
  the table owner or a superuser**: owners and superusers bypass RLS, but a
  `SET ROLE` to a restricted role makes it bind. This is asserted by the
  integration test (`tenant.rls.test.ts`, "RLS actually binds").
* Repositories additionally filter by `ctx.workspaceId` in their `WHERE`
  clauses — RLS is defense in depth, not a substitute for app-side scoping.
* Non-uuid workspace ids (e.g. the pre-auth `"system"` sentinel) are rejected
  before any SQL runs (fail closed).

For repositories that already own a transaction (e.g. T14 ingest), call
`applyTenantScope(tx, workspaceId)` instead.

## Pre-auth lookups (intentional exceptions)

Login/token flows query **before** any workspace is known:

* `users` by email — no RLS (login plane).
* `api_tokens` by token hash — `SELECT` is allowed to any role (`token_lookup_plane`
  policy): the sha256 hash is the credential and queries are hash-keyed.
  Writes on `api_tokens` stay tenant-strict.
* `memberships` for the login plane — the policy has a second arm,
  `user_id = current_setting('app.user_id', true)::uuid`; login-plane code can
  use `withUserScope(db, userId, fn)` so it keeps working when the connection
  user is not the table owner.
* Today these lookups run as the `DATABASE_URL` user (owner plane, RLS
  bypassed). If `DATABASE_URL` ever becomes a non-owner role, wrap them with
  `withUserScope` / grant membership as documented above.

## Policies (summary)

| Table | Policy | Rule |
|---|---|---|
| `documents` | `tenant_isolation` | `workspace_id = current_setting('app.workspace_id', true)::uuid` (USING + WITH CHECK) |
| `documents` | `ingest_published_read` | `TO formforge_ingest FOR SELECT USING (status = 'published')` |
| `document_versions` | `tenant_isolation` | direct `workspace_id` |
| `snapshots` | `tenant_isolation` | `EXISTS (documents d WHERE d.id = snapshots.document_id AND d.workspace_id = …)` |
| `snapshots` | `ingest_published_read` | `TO formforge_ingest` via published document |
| `submissions` | `tenant_isolation` | direct `workspace_id` |
| `submissions` | `ingest_token_plane` | `TO formforge_ingest FOR SELECT USING (true)` — the opaque public token is the credential; writes are NOT relaxed (ingest must set `app.workspace_id` after resolving the published document) |
| `answers` | `tenant_isolation` | via owning `submissions` row |
| `answers` | `ingest_token_plane` | `TO formforge_ingest` via submission |
| `memberships` | `tenant_isolation` | `workspace_id = … OR user_id = current_setting('app.user_id', true)::uuid` |
| `api_tokens` | `token_lookup_plane` / `token_tenant_writes` / `token_tenant_update` / `token_tenant_delete` | SELECT = lookup plane; INSERT/UPDATE/DELETE tenant-strict |

All policies use the two-arg `current_setting('app.workspace_id', true)`:
unset ⇒ `NULL` ⇒ no rows (fail closed), never a hard error.

## Tests

* DB-free guards: `src/migrations.rls.test.ts` (policy coverage + idempotency
  markers + grant minimality), `src/schema/tenancy.test.ts`, and
  `src/repositories/tenant.test.ts` (scope SQL is parameterized; non-uuid ids
  rejected).
* Live-DB acceptance test: `src/repositories/tenant.rls.test.ts` — gated by
  `RUN_DB_TESTS=1` (CI wires `DATABASE_URL`; it also needs
  `RUN_DB_TESTS: "1"` added to the CI env once the integrator flips it on).
  It proves: workspace A cannot read/mutate workspace B documents through any
  repository function (forged ids → `null`/`NOT_FOUND`), RLS truly binds, the
  migration re-applies idempotently, and `formforge_ingest` stays limited.
