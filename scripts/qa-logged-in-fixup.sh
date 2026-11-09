#!/usr/bin/env bash
# Fix-up QA pass: login as the QA user, ingest a submission (visible errors),
# then create+publish a page doc and open its public URL from the publish response.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
mkdir -p "$LOG"

pkill -f next-server 2>/dev/null || true
sleep 1

cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup.log" 2>&1 &
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
echo "  landed on: $(ab get url 2>/dev/null | tail -1)"
ab screenshot "$LOG/15-login-dashboard.png" >/dev/null 2>&1 && echo "  shot 15 ok (session persists across restarts)"

HREF=$(ab eval "document.querySelector('a.ff-doc-title')?.getAttribute('href') || 'NONE'" 2>/dev/null | tail -1)
DOCID=$(echo "$HREF" | sed -E 's#.*"*/d/([^/]+)/results.*#\1#')
echo "  doc id: $DOCID"

echo "== ingest start (errors visible)"
ab open "http://localhost:3000/dashboard" >/dev/null 2>&1
START_RAW=$(ab eval "fetch('/api/public/ingest/submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:'$DOCID'})}).then(r=>r.status+' | '+r.text().then(t=>String(t).slice(0,180)))" 2>&1 | tail -3)
echo "  raw: $START_RAW"
START=$(ab eval "fetch('/api/public/ingest/submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:'$DOCID'})}).then(r=>r.json().then(j=>(j.token||j.submissionToken||'NOTOKEN')+' status'+r.status))" 2>/dev/null | tail -1)
echo "  start result: $START"
TOKEN=$(echo "$START" | sed -E 's/^"?([A-Za-z0-9._-]+) status[0-9]+"?$/\1/')
echo "  token len: ${#TOKEN}"
if [ -n "$TOKEN" ] && [ "$TOKEN" != "NOTOKEN" ] && [ ${#TOKEN} -lt 100 ]; then
  DONE=$(ab eval "fetch('/api/public/ingest/submissions/$TOKEN/complete',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'qa-complete-2'},body:JSON.stringify({answers:[{blockId:'name',value:'Ada Lovelace'},{blockId:'email',value:'ada@example.com'},{blockId:'topic',value:'topic-o1'},{blockId:'message',value:'Hello from logged-in QA. The conversational renderer should show this text.'}]})}).then(r=>r.status+' | '+r.text().then(t=>String(t).slice(0,160)))" 2>/dev/null | tail -1)
  echo "  complete: $DONE"

  ab open "http://localhost:3000/d/$DOCID/results" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/08-results-data.png" >/dev/null 2>&1 && echo "  shot 08-results-data ok (with submission)"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
  ab open "http://localhost:3000/d/$DOCID/analytics" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/09-analytics-data.png" >/dev/null 2>&1 && echo "  shot 09-analytics-data ok (with data)"
else
  echo "  STILL NO TOKEN — will debug from server log"
  tail -5 "$LOG/server-fixup.log" | sed 's/^/  srv: /'
fi

echo "== page doc -> public scroll plane (parse id|slug safely)"
PINFO=$(ab eval "fetch('/api/v1/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'page',title:'QA Landing Page'})}).then(r=>r.json().then(j=>j.id+'|'+j.slug))" 2>/dev/null | tail -1)
PINFO=$(echo "$PINFO" | tr -d '"' | tr -d '\\')
PAGEID="${PINFO%%|*}"; PAGESLUG="${PINFO##*|}"
echo "  page id: $PAGEID  slug: $PAGESLUG"
if [ -n "$PAGEID" ] && [ ${#PAGEID} -lt 60 ]; then
  PUBURL=$(ab eval "fetch('/api/v1/documents/$PAGEID/publish',{method:'POST'}).then(r=>r.json().then(j=>j.url||('ERR'+r.status)))" 2>/dev/null | tail -1 | tr -d '"' | tr -d '\\')
  echo "  public url: $PUBURL"
  case "$PUBURL" in http*) ab open "$PUBURL" >/dev/null 2>&1
    ab wait --load networkidle >/dev/null 2>&1; sleep 1
    ab screenshot "$LOG/10-public-page.png" >/dev/null 2>&1 && echo "  shot 10-public-page ok"
    ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /';;
  *) echo "  WARN: no public url returned";;
  esac
fi

ab close >/dev/null 2>&1
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== fix-up finished"
