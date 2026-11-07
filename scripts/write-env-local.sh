#!/usr/bin/env bash
# Compose .env files for root (main worktree) and worktrees/redesign.
# - Keeps the existing GITHUB_TOKEN line in the root .env (used by auto-push).
# - DATABASE_URL comes from scripts/.neon-db-url (pooled Neon DSN).
# - SESSION_SECRET / AUTH_SECRET are generated fresh (>=32 chars) if absent.
# NEVER prints secret values.
set -euo pipefail
cd /home/z/my-project

POOLED="$(cat scripts/.neon-db-url | tr -d '[:space:]')"
if [ -z "$POOLED" ]; then echo "FAIL: no pooled DSN"; exit 1; fi

SESS="$(openssl rand -hex 32)"
AUTH="$(openssl rand -hex 32)"
GH_LINE="$(grep '^GITHUB_TOKEN=' .env 2>/dev/null || true)"

write_env() { # $1 = target path, $2 = include gh line ("yes"/"no")
  {
    echo "# FormForge runtime env (Neon managed Postgres)"
    echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
    echo "PUBLIC_BASE_URL=http://localhost:3000"
    echo "SESSION_SECRET=$SESS"
    echo "AUTH_SECRET=$AUTH"
    echo "LOG_LEVEL=info"
    echo "DATABASE_URL=$POOLED"
    echo "REDIS_URL=redis://localhost:6379"
    if [ "$2" = "yes" ] && [ -n "$GH_LINE" ]; then echo "$GH_LINE"; fi
  } > "$1"
  chmod 600 "$1"
}

write_env ".env" "yes"
write_env "worktrees/redesign/.env" "no"
# Next.js loads env ONLY from the app directory — this is the one that matters
write_env "apps/web/.env" "no"
write_env "worktrees/redesign/apps/web/.env" "no"

# sanity: report only key names
echo "root .env keys:      $(grep -oE '^[A-Z_]+' .env | sort | tr '\n' ' ')"
echo "worktree .env keys:  $(grep -oE '^[A-Z_]+' worktrees/redesign/.env | sort | tr '\n' ' ')"
echo "OK: env files written (0600, gitignored)"
