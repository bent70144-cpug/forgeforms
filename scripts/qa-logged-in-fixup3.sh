#!/usr/bin/env bash
# Fix-up pass 3: REDIS_URL="" (empty string beats Next's .env loader), ingest
# via plain curl (public API), verify rows in Neon, then browser shots.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
mkdir -p "$LOG"

pkill -f next-server 2>/dev/null || true
sleep 1

cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
export REDIS_URL=""   # empty string: Next env loader keeps it; ingest uses in-memory stores
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup3.log" 2>&1 &
SRV=$!
cd "$ROOT"

for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"

DOCID=$(cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url-direct','utf8').trim()});
  await c.connect();
  const r=await c.query(\"select id from documents where title='QA Contact Form' order by created_at desc limit 1\");
  console.log(r.rows[0]?.id || 'NONE');
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
")
echo "doc id (from Neon): $DOCID"
[ "$DOCID" = "NONE" ] || [ -z "$DOCID" ] && { echo "FATAL: doc not found"; kill $SRV; exit 1; }

echo "== ingest start (curl)"
START=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/public/ingest/submissions \
  -H "Content-Type: application/json" -d "{\"documentId\":\"$DOCID\"}")
CODE=$(echo "$START" | tail -1); BODY=$(echo "$START" | head -1)
echo "  status: $CODE body: ${BODY:0:150}"
TOKEN=$(echo "$BODY" | sed -E 's/.*"token":"([^"]+)".*/\1/')
if [ "$CODE" = "201" ] && [ -n "$TOKEN" ] && [ ${#TOKEN} -lt 100 ]; then
  echo "== ingest complete (curl)"
  DONE=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3000/api/public/ingest/submissions/$TOKEN/complete" \
    -H "Content-Type: application/json" -H "Idempotency-Key: qa-complete-4" \
    -d '{"answers":[{"blockId":"name","value":"Ada Lovelace"},{"blockId":"email","value":"ada@example.com"},{"blockId":"topic","value":"topic-o1"},{"blockId":"message","value":"Hello from logged-in QA. The conversational renderer should show this text."}]}')
  echo "  status: $(echo "$DONE" | tail -1) body: $(echo "$DONE" | head -1 | head -c 150)"

  echo "== verify rows in Neon"
  cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url-direct','utf8').trim()});
  await c.connect();
  const s=await c.query(\"select status, completed_at is not null as done from submissions where document_id='$(echo $DOCID)'\");
  console.log('submissions:', JSON.stringify(s.rows));
  const a=await c.query('select count(*)::int as n from answers');
  console.log('answers total:', a.rows[0].n);
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
"
  cd "$ROOT"
else
  echo "  INGEST FAILED — redis errors in log: $(grep -c ioredis "$LOG/server-fixup3.log" 2>/dev/null || echo 0)"
  grep -iE "error|ERR" "$LOG/server-fixup3.log" | tail -4 | sed 's/^/  srv: /'
fi

echo "== browser: results + analytics with data"
ab() { agent-browser "$@"; }
ab set viewport 1440 900
ab open http://localhost:3000/login >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
ab find label "Email" fill "qa-1794071294@formforge.test" >/dev/null 2>&1
ab find label "Password" fill "qa-passphrase-9" >/dev/null 2>&1
ab find role button click --name "Log in" >/dev/null 2>&1
ab wait --url "/dashboard" --timeout 20000 >/dev/null 2>&1
echo "  logged in: $(ab get url 2>/dev/null | tail -1)"

ab open "http://localhost:3000/d/$DOCID/results" >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
ab screenshot "$LOG/08-results-data.png" >/dev/null 2>&1 && echo "  shot 08-results-data ok"
ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
ab open "http://localhost:3000/d/$DOCID/analytics" >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
ab screenshot "$LOG/09-analytics-data.png" >/dev/null 2>&1 && echo "  shot 09-analytics-data ok"
ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'

ab close >/dev/null 2>&1
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== fix-up 3 finished"
