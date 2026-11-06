# @formforge/db

Drizzle schema, migrations, and repositories (spec §2/§6).

## Tenancy & RLS (T04)

Every tenant table is protected by Postgres row-level security keyed on
`current_setting('app.workspace_id')`, and repository code reaches the DB only
through `withTenantScope()` (`src/repositories/tenant.ts`), which opens a
transaction, sets `app.workspace_id`, and assumes the restricted
`formforge_app` role so RLS binds. Details, policy table, and pre-auth
exceptions: **[TENANCY.md](./TENANCY.md)**.

## Dedicated DB roles

| Role | Purpose |
|---|---|
| `formforge_app` | application plane (assumed per transaction by `withTenantScope`) |
| `formforge_ingest` | **public ingest plane** — limited to published-document reads (`documents`/`snapshots`) plus `SELECT/INSERT/UPDATE` on `submissions`/`answers` (+ `assets` when that table lands). **No `DELETE`, no memberships/api_tokens access.** T14 (public plane) should connect as / assume this role. |

Both roles are `NOLOGIN` and created idempotently by
`drizzle/0003_tenancy_rls.sql`.

## Scripts

- `pnpm db:generate` — drizzle-kit generate (schema → migration)
- `pnpm db:migrate` — apply pending migrations
- `pnpm test` — unit tests; RLS integration tests additionally require
  `RUN_DB_TESTS=1` and a live `DATABASE_URL` (CI provides a Postgres service)
