#!/usr/bin/env bash
# Start the production web server for QA with env from apps/web/.env.
# Parse-safe: reads KEY=VALUE line by line (values may contain & ? : / etc.)
# without shell-sourcing the file. Shell env always beats .env for next start.
ENVF="/home/z/my-project/worktrees/redesign/apps/web/.env"
while IFS='=' read -r k v; do
  case "$k" in ''|\#*) continue ;; esac
  export "$k=$v"
done < "$ENVF"
cd /home/z/my-project/worktrees/redesign/apps/web || exit 1
exec node node_modules/next/dist/bin/next start -p 3000
