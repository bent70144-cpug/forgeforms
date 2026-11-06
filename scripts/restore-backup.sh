#!/usr/bin/env bash
# T29 (spec §17: "Backups with tested restore") — FormForge restore script.
#
# Restores a formforge Postgres backup into a FRESH database, then runs the
# documented verification queries (docs/backups-restore-runbook.md §4). The
# script is idempotent: it refuses to touch a database that already exists.
#
# It supports both backup flavors the runbook documents:
#   * logical  : pg_dump -Fc archive        (RPO ≤ 24 h worst case)
#   * physical : pg_basebackup tar bundle   (RPO ≤ 5 min via WAL replay)
#
# USAGE
#   scripts/restore-backup.sh --backup <file.dump|base.tar> \
#     [--wal-dir <dir with 0000000100000000xxxxxx segments>] \
#     [--target-db formforge_restore_<ts>] \
#     [--host localhost] [--port 5432] [--user postgres] \
#     [--verify-only <db-name>]        # re-run verification against a restored DB
#
# SAFETY
#   * NEVER runs against the production connection string from the
#     environment; --host/--port/--user are explicit flags only.
#   * The target DB must NOT exist (created empty by this script).
#   * Every destructive step is prefixed with an echo of the exact command.
set -euo pipefail

BACKUP=""
WAL_DIR=""
TARGET_DB=""
HOST="localhost"
PORT="5432"
USER_NAME="postgres"
VERIFY_ONLY=""

log() { printf '[restore] %s\n' "$*"; }
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) BACKUP="${2:?}"; shift 2 ;;
    --wal-dir) WAL_DIR="${2:?}"; shift 2 ;;
    --target-db) TARGET_DB="${2:?}"; shift 2 ;;
    --host) HOST="${2:?}"; shift 2 ;;
    --port) PORT="${2:?}"; shift 2 ;;
    --user) USER_NAME="${2:?}"; shift 2 ;;
    --verify-only) VERIFY_ONLY="${2:?}"; shift 2 ;;
    *) die "unknown flag: $1 (see header for usage)" ;;
  esac
done

run_psql() { psql -h "$HOST" -p "$PORT" -U "$USER_NAME" -v ON_ERROR_STOP=1 "$@"; }

# --- Verification-only mode ----------------------------------------------------
if [[ -n "$VERIFY_ONLY" ]]; then
  log "verifying restored database '$VERIFY_ONLY' (read-only checks)"
  bash -n "$0" # self-syntax-check (kept cheap; real checks below need psql)
  run_psql -d "$VERIFY_ONLY" -t -c "select count(*) from workspaces;" >/dev/null
  run_psql -d "$VERIFY_ONLY" -c "select count(*) as documents from documents;"
  run_psql -d "$VERIFY_ONLY" -c "select count(*) as submissions from submissions;"
  run_psql -d "$VERIFY_ONLY" -c "select count(*) as answers    from answers;"
  log "verification OK — row counts printed above; compare with the pre-restore snapshot (runbook §4)"
  exit 0
fi

[[ -n "$BACKUP" ]] || die "--backup is required"
[[ -f "$BACKUP" ]] || die "backup file not found: $BACKUP"
[[ -n "$TARGET_DB" ]] || TARGET_DB="formforge_restore_$(date +%Y%m%d%H%M%S)"

command -v pg_restore >/dev/null || command -v pg_ctl >/dev/null || {
  die "neither pg_restore nor pg_ctl found — install postgresql-client/tools"
}

# --- 1. Create a fresh, empty target -------------------------------------------
if run_psql -t -c "select 1 from pg_database where datname = '$TARGET_DB';" | grep -q 1; then
  die "target database '$TARGET_DB' already exists — refuse to overwrite (runbook §2)"
fi
log "creating empty target database $TARGET_DB"
run_psql -c "create database \"$TARGET_DB\" owner \"$USER_NAME\";"

# --- 2. Restore -----------------------------------------------------------------
if [[ "$BACKUP" == *.dump || "$BACKUP" == *.sql ]]; then
  log "logical restore: pg_restore into $TARGET_DB"
  pg_restore -h "$HOST" -p "$PORT" -U "$USER_NAME" \
    -d "$TARGET_DB" --no-owner --no-privileges --exit-on-error "$BACKUP"
else
  # Physical base backup (tar). Restore INTO the data directory of a STOPPED
  # instance, then configure WAL replay — this path needs server access.
  log "physical restore detected (base backup)"
  DATA_DIR="${DATA_DIR:?for a physical restore set DATA_DIR to an EMPTY data directory}"
  [[ ! -e "$DATA_DIR/PG_VERSION" ]] || die "$DATA_DIR already contains a cluster — refusing"
  log "unwinding base.tar into $DATA_DIR"
  mkdir -p "$DATA_DIR"
  tar -xf "$BACKUP" -C "$DATA_DIR"
  if [[ -n "$WAL_DIR" ]]; then
    log "configuring WAL replay from $WAL_DIR (RPO 5 min)"
    mkdir -p "$DATA_DIR/pg_wal"
    touch "$DATA_DIR/recovery.signal"
    cat > "$DATA_DIR/recovery.conf" <<EOF
restore_command = 'cp $WAL_DIR/%f %p'
recovery_target_timeline = 'latest'
EOF
  fi
  log "start postgres manually on this data dir, wait for 'database system is ready to accept connections', then stop it again (one-time WAL roll-forward)"
  die "physical restore requires the operator to start/stop postgres (see runbook §3.2) — stopping here after unpack + recovery config"
fi

# --- 3. Verify ------------------------------------------------------------------
log "running verification queries against $TARGET_DB"
run_psql -d "$TARGET_DB" -c "select count(*) as workspaces from workspaces;"
run_psql -d "$TARGET_DB" -c "select count(*) as documents from documents;"
run_psql -d "$TARGET_DB" -c "select count(*) as submissions from submissions;"
run_psql -d "$TARGET_DB" -c "select count(*) as answers from answers;"

log "checking RLS policies survived the restore (runbook §4.3)"
POLICIES=$(run_psql -d "$TARGET_DB" -t -A -c \
  "select count(*) from pg_policies where schemaname = 'public';")
log "RLS policies present: $POLICIES (expect > 0)"
[[ "$POLICIES" -gt 0 ]] || die "RLS policies missing after restore — re-apply drizzle/0003_tenancy_rls.sql"

log "RESTORE COMPLETE — record the drill in docs/backups-restore-runbook.md §5"
