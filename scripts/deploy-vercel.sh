#!/usr/bin/env bash
# One-command production deploy of FormForge to Vercel.
#
# Usage:
#   VERCEL_TOKEN=<full-scope token> ./scripts/deploy-vercel.sh
#
# Requires a Vercel token created at https://vercel.com/account/settings/tokens
# while signed in to the account that owns the projects (full scope — the
# token provided on 2026-11-09 authenticates but is not authorized for any
# project scope, so it cannot list or deploy).
set -euo pipefail

: "${VERCEL_TOKEN:?Set VERCEL_TOKEN to a full-scope Vercel token}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)/apps/web"
cd "$APP_DIR"

# --- env for the deployment (build-time + runtime) --------------------------
if [ ! -f .env ]; then echo "FAIL: apps/web/.env missing (run the env writer first)"; exit 1; fi
set -a; . <(grep -v '^#' .env | grep -v '^$'); set +a

npx -y vercel@latest deploy --prod --yes --token="$VERCEL_TOKEN"

echo "After the first deploy, set these Project Environment Variables in the"
echo "Vercel dashboard (or let this script's env pass through):"
echo "  DATABASE_URL=$DATABASE_URL"
echo "  SESSION_SECRET/AUTH_SECRET (>=32 chars each, already in apps/web/.env)"
echo "  NEXT_PUBLIC_APP_URL / PUBLIC_BASE_URL (your production URL)"
echo "  NEXT_PUBLIC_RESULTS_MODE=fetch"
