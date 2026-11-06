#!/usr/bin/env bash
# auto-push.sh — checkpoint-commit and push /home/z/my-project to GitHub (forgeforms).
# Safe to run repeatedly; skips everything when there is nothing to push.
# NEVER prints the token (masked in output).
set -uo pipefail
cd /home/z/my-project || { echo "FAIL: project dir missing"; exit 1; }

# 0. Sandbox file-sync flips tracked files to 0755 between runs; normalize
#    every tracked file back to 0644 before status (the repo has no
#    intentionally-executable files — invoked via `bash scripts/auto-push.sh`).
git ls-files -z | xargs -0 -r chmod 644 -- 2>/dev/null || true

# 1. Commit any pending work (gitignore already excludes .env, upload/, skills/)
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "auto: checkpoint $(date -u '+%Y-%m-%d %H:%M UTC')" \
    && echo "committed: $(git log -1 --oneline)" \
    || echo "nothing to commit (only ignored/unstaged changes)"
fi

# 2. Token: primary source is the GITHUB_TOKEN line in .env; fallback to
#    scripts/.gh-token (gitignored, 0600) because the sandbox sync keeps
#    wiping the .env line. Never printed.
TOKEN=$(grep '^GITHUB_TOKEN=' .env | cut -d= -f2- | tr -d '[:space:]')
if [ -z "$TOKEN" ] && [ -f scripts/.gh-token ]; then
  TOKEN=$(tr -d '[:space:]' < scripts/.gh-token)
fi
if [ -z "$TOKEN" ]; then
  echo "PENDING: GITHUB_TOKEN not found in .env — nothing pushed; checkpoint stays local and will push on a future run once the token line is restored"
  exit 1
fi

# 3. Push if local main is ahead of remote (fetch via one-off URL, no rebase)
git fetch -q "https://bent70144-cpug:${TOKEN}@github.com/bent70144-cpug/forgeforms.git" main 2>/dev/null
AHEAD=$(git rev-list --count FETCH_HEAD..main 2>/dev/null || echo "1")
if [ "$AHEAD" = "0" ]; then
  echo "OK: nothing to push (up to date with origin/main)"
  exit 0
fi

# 4. Push via one-off authenticated URL; token never lands in output or .git/config
if git push -q "https://bent70144-cpug:${TOKEN}@github.com/bent70144-cpug/forgeforms.git" main 2>&1 | sed "s/${TOKEN}/***TOKEN***/g"; then
  echo "OK: pushed ${AHEAD} commit(s) to bent70144-cpug/forgeforms main"
else
  echo "FAIL: push rejected (check token validity / permissions)"
  exit 1
fi
