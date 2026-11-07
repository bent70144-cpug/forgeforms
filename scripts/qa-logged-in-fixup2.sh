#!/usr/bin/env bash
# Fix-up pass 2: ingest a real submission (no REDIS_URL -> in-memory stores),
# then capture results/analytics with data.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
mkdir -p "$LOG"

pkill -f next-server 2>/dev/null || true
sleep 1

cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
unset REDIS_URL   # ingest falls back to in-memory idempotency + event queue (no redis in sandbox)
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup2.log" 2>&1 &
SRV=$!
cd "$ROOT"

for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"

ab() { agent-browser "$@"; }
ab set viewport 1440 900

echo "== login as QA user"
ab open http://localhost:3000/login >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
ab find label "Email" fill "qa-1794071294@formforge.test" >/dev/null 2>&1
ab find label "Password" fill "qa-passphrase-9" >/dev/null 2>&1
ab find role button click --name "Log in" >/dev/null 2>&1
ab wait --url "/dashboard" --timeout 20000 >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
sleep 2

DOCID=""
for try in 1 2 3; do
  HREF=$(ab eval "document.querySelector('a.ff-doc-title')?.getAttribute('href') || 'NONE'" 2>/dev/null | tail -1 | tr -d '"' | tr -d '\\')
  case "$HREF" in /d/*) DOCID=$(echo "$HREF" | sed -E 's#.*"*/d/([^/]+)/results.*#\1#'); break ;; esac
  echo "  card not ready (try $try): $HREF"; sleep 2
done
echo "  doc id: $DOCID"
[ -z "$DOCID" ] && { echo "FATAL: no doc card"; kill $SRV 2>/dev/null; exit 1; }

echo "== ingest start"
START=$(ab eval "fetch('/api/public/ingest/submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:'$DOCID'})}).then(r=>r.json().then(j=>r.status+'|'+(j.token||'NOTOKEN')))" 2>/dev/null | tail -1 | tr -d '"' | tr -d '\\')
echo "  start: $START"
TOKEN=$(echo "$START" | sed -E 's/^[0-9]+\|//')
if [ -n "$TOKEN" ] && [ "$TOKEN" != "NOTOKEN" ] && [ ${#TOKEN} -lt 100 ]; then
  echo "== ingest complete"
  DONE=$(ab eval "fetch('/api/public/ingest/submissions/$TOKEN/complete',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'qa-complete-3'},body:JSON.stringify({answers:[{blockId:'name',value:'Ada Lovelace'},{blockId:'email',value:'ada@example.com'},{blockId:'topic',value:'topic-o1'},{blockId:'message',value:'Hello from logged-in QA. The conversational renderer should show this text.'}]})}).then(r=>r.json().then(j=>r.status+'|'+JSON.stringify(j).slice(0,140)))" 2>/dev/null | tail -1 | tr -d '"' | tr -d '\\')
  echo "  complete: $DONE"

  ab open "http://localhost:3000/d/$DOCID/results" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
  ab screenshot "$LOG/08-results-data.png" >/dev/null 2>&1 && echo "  shot 08-results-data ok (with submission)"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
  ab open "http://localhost:3000/d/$DOCID/analytics" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
  ab screenshot "$LOG/09-analytics-data.png" >/dev/null 2>&1 && echo "  shot 09-analytics-data ok (with data)"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
else
  echo "  NO TOKEN — server log tail:"
  grep -iE "error|fail" "$LOG/server-fixup2.log" | tail -4 | sed 's/^/  srv: /'
fi

ab close >/dev/null 2>&1
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== fix-up 2 finished"
