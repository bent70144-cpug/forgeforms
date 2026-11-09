#!/usr/bin/env bash
# Pass 7c: public PAGE doc lives at /p/{publicBase}/{slug} (two segments, same
# shape as the form's publish URL). Verify via curl, then shoot.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
BASE="01a1bfaa-00de-7489-af61-c3233bf41df5"
URL="http://localhost:3000/p/$BASE/qa-landing-page"

pkill -f next-server 2>/dev/null || true; sleep 1
cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
export REDIS_URL=""
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup7c.log" 2>&1 &
SRV=$!
cd "$ROOT"
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"
echo "public page HTTP: $(curl -s -o /dev/null -w '%{http_code}' "$URL")"

if [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL")" = "200" ]; then
  ab() { agent-browser "$@"; }
  ab set viewport 1440 900
  ab open "$URL" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
  echo "url: $(ab get url 2>/dev/null | tail -1)"
  echo "title: $(ab get title 2>/dev/null | tail -1)"
  ab screenshot "$LOG/10-public-page.png" >/dev/null 2>&1 && echo "shot 10-public-page ok"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
  ab close >/dev/null 2>&1
fi
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== pass 7c finished"
