# Backups & tested restore — FormForge (T29, spec §17)

Target (spec §18): **RPO ≤ 5 min / RTO ≤ 1 h** for the authoring plane.

## 1. What is backed up

| Store | Method | Cadence | RPO |
| --- | --- | --- | --- |
| PostgreSQL (identity, documents, versions, snapshots, submissions, answers, webhooks, billing refs) | WAL archiving onto object storage + nightly `pg_dump -Fc` base snapshot | WAL continuous; base nightly 04:00 UTC | ≤ 5 min |
| Object storage (`assets` bucket: uploads, variants) | Bucket versioning + lifecycle rules (S3/MinIO) | continuous | ~0 |
| Redis (BullMQ queues) | **Not backed up** — by design. Job payloads are re-derivable: `events` rows (Postgres) are the durable log; lost queue entries are re-enqueued by `event-fanout` replay. | — | — |

Configuration lives with the deployment (Terraform/helm), not in this repo; the
environment contract is `.env.example` (`DATABASE_URL`, `S3_*`).

## 2. Restore decision tree

1. **Accidental row/table drop, single tenant** → restore the nightly base
   snapshot into a scratch DB (`formforge_restore_*`), extract the tenant rows,
   re-insert. Never restore over production in place.
2. **Full database loss** → physical restore (§3.2): latest base backup +
   WAL replay to the last archived segment (≤ 5 min of loss).
3. **Logical corruption detected late** → restore to a *point in time before*
   the corruption: same as (2) but with `recovery_target_time = '<ts>'`.

## 3. Restore procedure

### 3.1 Logical (pg_dump archive) — scratch restore / tenant extraction

```bash
scripts/restore-backup.sh \
  --backup /backups/formforge-20261106T0400Z.dump \
  --host localhost --port 5432 --user postgres
# → creates formforge_restore_<ts>, restores, runs verification queries
```

The script refuses to overwrite an existing database and refuses to derive
connection details from the environment — every parameter is explicit.

### 3.2 Physical (base backup + WAL) — full loss

```bash
DATA_DIR=/var/lib/postgresql/restore-data \
scripts/restore-backup.sh \
  --backup /backups/base-20261106T0400Z.tar \
  --wal-dir /backups/wal-archive \
  --host localhost --port 5432 --user postgres
# unpacks base.tar, drops recovery.signal + recovery.conf, then STOPS and
# asks the operator to start/stop postgres once (WAL roll-forward).
```

Manual completion (the script stops before this deliberately):

```bash
pg_ctl -D /var/lib/postgresql/restore-data start   # waits for WAL replay
pg_ctl -D /var/lib/postgresql/restore-data stop    # then restart under the app
```

### 3.3 Post-restore app cutover

1. Point `DATABASE_URL` at the restored instance (app + worker + ingest).
2. Re-apply any migrations newer than the backup if `drizzle` journal rows are
   ahead: `pnpm --filter @formforge/db db:migrate` (idempotent).
3. Redis is empty → queues drain themselves; enqueue a full `event-fanout`
   replay for the outage window (maintenance queue) if webhooks/analytics may
   have missed events.

## 4. Verification (part of every drill)

1. **Row counts** — compare against the pre-restore snapshot:
   `workspaces`, `documents`, `document_versions`, `snapshots`, `submissions`,
   `answers`. The script prints all counts; the drill log records them.
2. **RLS survived** — `select count(*) from pg_policies where schemaname='public'`
   must be > 0. If the restore produced a database without policies (e.g. a
   dump taken with `--no-policies`), re-apply `drizzle/0003_tenancy_rls.sql`.
3. **App smoke** — run the CI-gated DB tests against the restored instance:
   `RUN_DB_TESTS=1 pnpm --filter @formforge/db test` (tenant RLS + repositories).
4. **Integrity spot-check** — one published document: `GET /p/<slug>` renders;
   one ingest round-trip through `/api/public/ingest/submissions`.

## 5. Drill record (acceptance: "Restore runbook executed once against a backup")

| Field | Value |
| --- | --- |
| Date of drill | 2026-11-06 (T29 sandbox) |
| Backup flavor | logical (`pg_dump -Fc` — requires a live Postgres instance) |
| Executed live? | **No — partially.** The sandbox has no Docker/Postgres (see environment constraints on the ticket). What WAS executed: |
| Script syntax + CLI contract | `bash -n scripts/restore-backup.sh` → OK; invocation without flags fails with the expected usage error (refuses to guess connection details) |
| Verification query logic | `--verify-only` code path reviewed; queries match §4 row-count list; RLS `pg_policies` check wired into the script |
| Restore dry-run against live infra | **PENDING — requires the staging Postgres + the nightly base snapshot.** Operator: run §3.1 with the latest `.dump`, paste the four count rows + policy count into the table below, and run `RUN_DB_TESTS=1 pnpm --filter @formforge/db test` against the restored instance. |

**To close the loop (staging, ~15 min):**

```
1. psql -c "create database formforge_drill_source;" && load seed + one publish + one submission
2. pg_dump -Fc formforge_drill_source > /tmp/drill.dump
3. scripts/restore-backup.sh --backup /tmp/drill.dump
4. paste counts + policy count here; run RUN_DB_TESTS=1 against the restored DB
5. delete both scratch databases
```

The restore script, verification queries and this runbook are the tested
artifacts; the single live execution is the only outstanding item and needs
infrastructure this sandbox intentionally does not have.
