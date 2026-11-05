#!/usr/bin/env bash
# auto-push.sh — checkpoint-commit and push /home/z/my-project to GitHub (forgeforms).
# Safe to run repeatedly; skips everything when there is nothing to push.
# NEVER prints the token (masked in output).
set -uo pipefail
cd /home/z/my-project || { echo "FAIL: project dir missing"; exit 1; }

TOKEN=$(grep '^GITHUB_TOKEN=' .env | cut -d= -f2- | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then
  echo "FAIL: GITHUB_TOKEN not found in .env"
  exit 1
fi

# 1. Commit any pending work (gitignore already excludes .env, upload/, skills/)
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "auto: checkpoint $(date -u '+%Y-%m-%d %H:%M UTC')" \
    && echo "committed: $(git log -1 --oneline)" \
    || echo "nothing to commit (only ignored/unstaged changes)"
fi

# 2. Push if local main is ahead of origin (fetch first, no rebase)
git fetch -q origin main 2>/dev/null
AHEAD=$(git rev-list --count origin/main..main 2>/dev/null || echo "1")
if [ "$AHEAD" = "0" ]; then
  echo "OK: nothing to push (up to date with origin/main)"
  exit 0
fi

# 3. Push via one-off authenticated URL; token never lands in output or .git/config
if git push -q "https://bent70144-cpug:${TOKEN}@github.com/bent70144-cpug/forgeforms.git" main 2>&1 | sed "s/${TOKEN}/***TOKEN***/g"; then
  echo "OK: pushed ${AHEAD} commit(s) to bent70144-cpug/forgeforms main"
else
  echo "FAIL: push rejected (check token validity / permissions)"
  exit 1
fi
