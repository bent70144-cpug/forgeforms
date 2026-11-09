#!/usr/bin/env bash
# Fix-up pass 4: complete the ingest using REAL block ids from the published
# snapshot, clean the extra draft, retake results/analytics shots with data.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
DOCID="01a1b6fb-b1bc-7c25-b09a-4f1293eb0927"

pkill -f next-server 2>/dev/null || true; sleep 1
cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
export REDIS_URL=""
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup4.log" 2>&1 &
SRV=$!
cd "$ROOT"
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"

echo "== published snapshot question blocks (id | kind | required)"
cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url-direct','utf8').trim()});
  await c.connect();
  const r=await c.query(\"select snapshot from snapshots where document_id='$(echo $DOCID)' order by created_at desc limit 1\");
  if(!r.rows.length){ console.log('NO SNAPSHOT'); process.exit(1); }
  const blocks=(r.rows[0].snapshot.blocks)||[];
  for(const b of blocks){
    const t=b.kind||b.type||'?';
    if(['text','divider','image'].includes(t)) continue;
    const opts=(b.options||b.props?.options||[]).map(o=>o.id).join(',');
    console.log([b.id,t,b.required?'req':'opt',opts].join(' | '));
  }
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
" 2>/dev/null
echo "== token reuse + complete with real ids"
# reuse the fresh token from fixup 3 (its draft is still open)
TOKEN="sub_1CgowmV9CVaXwKgXsHZZNn"
# build answers from the snapshot ids printed above is manual; do it programmatically:
ANSWERS=$(cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url-direct','utf8').trim()});
  await c.connect();
  const r=await c.query(\"select snapshot from snapshots where document_id='$(echo $DOCID)' order by created_at desc limit 1\");
  const blocks=((r.rows[0].snapshot).blocks)||[];
  const byKind=(k)=>blocks.find(b=>(b.kind||b.type)===k);
  const name=byKind('short-text')||byKind('shortText');
  const email=byKind('email');
  const topic=byKind('single-select')||byKind('singleSelect');
  const msg=byKind('long-text')||byKind('longText');
  const out=[];
  if(name) out.push({blockId:name.id, value:'Ada Lovelace'});
  if(email) out.push({blockId:email.id, value:'ada@example.com'});
  if(topic){ const o=(topic.options||[])[0]; if(o) out.push({blockId:topic.id, value:o.id}); }
  if(msg) out.push({blockId:msg.id, value:'Hello from logged-in QA. The conversational renderer should show this text.'});
  console.log(JSON.stringify({answers:out}));
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
" 2>/dev/null)
echo "  payload: ${ANSWERS:0:220}"
DONE=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3000/api/public/ingest/submissions/$TOKEN/complete" \
  -H "Content-Type: application/json" -H "Idempotency-Key: qa-complete-5" -d "$ANSWERS")
echo "  complete status: $(echo "$DONE" | tail -1)"
echo "  complete body: $(echo "$DONE" | head -1 | head -c 220)"

echo "== tidy: drop the extra draft submission for this doc"
cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url-direct','utf8').trim()});
  await c.connect();
  const before=await c.query(\"select status, count(*)::int n from submissions where document_id='$(echo $DOCID)' group by 1\");
  console.log('before:', JSON.stringify(before.rows));
  await c.query(\"delete from submissions where document_id='$(echo $DOCID)' and status='draft'\");
  const after=await c.query(\"select status, count(*)::int n from submissions where document_id='$(echo $DOCID)' group by 1\");
  console.log('after:', JSON.stringify(after.rows));
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
" 2>/dev/null
cd "$ROOT"

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
echo "== fix-up 4 finished"
