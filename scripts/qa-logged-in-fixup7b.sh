#!/usr/bin/env bash
# Pass 7b: publish the QA page doc (fixed eval scoping) and shoot the public page.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
PAGEID="01a1bfaa-82fc-7a52-953a-bebbcc0e287b"

pkill -f next-server 2>/dev/null || true; sleep 1
cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
export REDIS_URL=""
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup7b.log" 2>&1 &
SRV=$!
cd "$ROOT"
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"

ab() { agent-browser "$@"; }
ab set viewport 1440 900
ab open http://localhost:3000/login >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
ab find label "Email" fill "qa-1794216947@formforge.test" >/dev/null 2>&1
ab find label "Password" fill "qa-passphrase-9" >/dev/null 2>&1
ab find role button click --name "Log in" >/dev/null 2>&1
ab wait --url "/dashboard" --timeout 20000 >/dev/null 2>&1
echo "logged in: $(ab get url 2>/dev/null | tail -1)"

PUB=$(ab eval "fetch('/api/v1/documents/$PAGEID/publish',{method:'POST'}).then(r=>String(r.status)).catch(e=>'ERR '+e.message)" 2>/dev/null | tail -1)
echo "publish status: $PUB"

ab open "http://localhost:3000/p/qa-landing-page" >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
echo "public url: $(ab get url 2>/dev/null | tail -1)"
echo "title: $(ab get title 2>/dev/null | tail -1)"
ab screenshot "$LOG/10-public-page.png" >/dev/null 2>&1 && echo "shot 10-public-page ok"
ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'

ab close >/dev/null 2>&1
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== pass 7b finished"
