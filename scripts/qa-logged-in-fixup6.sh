#!/usr/bin/env bash
# Final pass 6: single-select value as {optionId}, verify, retake shots.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
DOCID="01a1b6fb-b1bc-7c25-b09a-4f1293eb0927"

pkill -f next-server 2>/dev/null || true; sleep 1
cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
export REDIS_URL=""
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup6.log" 2>&1 &
SRV=$!
cd "$ROOT"
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"

START=$(curl -s -w "|%{http_code}" -X POST http://localhost:3000/api/public/ingest/submissions \
  -H "Content-Type: application/json" -d "{\"documentId\":\"$DOCID\"}")
CODE="${START##*|}"; BODY="${START%|*}"
TOKEN=$(echo "$BODY" | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "start: $CODE"

ANSWERS='{"answers":[{"blockId":"LGXycF5B6n","value":"Ada Lovelace"},{"blockId":"mrIDHLljjW","value":"ada@example.com"},{"blockId":"muiXM9giax","value":{"optionId":"topic-o1"}},{"blockId":"efoAuKk-Wx","value":"Hello from logged-in QA. The conversational renderer should show this text."}]}'
DONE=$(curl -s -w "|%{http_code}" -X POST "http://localhost:3000/api/public/ingest/submissions/$TOKEN/complete" \
  -H "Content-Type: application/json" -H "Idempotency-Key: qa-complete-7" -d "$ANSWERS")
DCODE="${DONE##*|}"; DBODY="${DONE%|*}"
echo "complete: $DCODE body: $(echo "$DBODY" | head -c 200)"

echo "== verify in Neon + tidy drafts"
cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url-direct','utf8').trim()});
  await c.connect();
  if ('$(echo $DCODE)' === '200') {
    await c.query(\"delete from submissions where document_id='01a1b6fb-b1bc-7c25-b09a-4f1293eb0927' and status='draft'\");
  }
  const s=await c.query(\"select status, count(*)::int n from submissions where document_id='01a1b6fb-b1bc-7c25-b09a-4f1293eb0927' group by 1\");
  console.log('submissions:', JSON.stringify(s.rows));
  const a=await c.query(\"select count(*)::int n from answers ans join submissions sub on sub.id=ans.submission_id where sub.document_id='01a1b6fb-b1bc-7c25-b09a-4f1293eb0927'\");
  console.log('answers for this doc:', a.rows[0].n);
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
" 2>&1 | grep -viE "warning|libpq|ssl|postgresql.org|trace-warn|^$|prepare for"
cd "$ROOT"

ab() { agent-browser "$@"; }
ab set viewport 1440 900
ab open http://localhost:3000/login >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
ab find label "Email" fill "qa-1794071294@formforge.test" >/dev/null 2>&1
ab find label "Password" fill "qa-passphrase-9" >/dev/null 2>&1
ab find role button click --name "Log in" >/dev/null 2>&1
ab wait --url "/dashboard" --timeout 20000 >/dev/null 2>&1
echo "logged in: $(ab get url 2>/dev/null | tail -1)"
ab open "http://localhost:3000/d/$DOCID/results" >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
ab screenshot "$LOG/08-results-data.png" >/dev/null 2>&1 && echo "shot 08-results-data ok"
ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
ab open "http://localhost:3000/d/$DOCID/analytics" >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
ab screenshot "$LOG/09-analytics-data.png" >/dev/null 2>&1 && echo "shot 09-analytics-data ok"
ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'

ab close >/dev/null 2>&1
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== pass 6 finished"
