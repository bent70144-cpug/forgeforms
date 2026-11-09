#!/usr/bin/env bash
# Final pass 7 (fresh recycle, new doc): curl-based ingest with real snapshot
# block ids, DB verify, retake results/analytics-with-data shots, redo the
# public page step with safe JSON parsing. Secrets never printed.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
DOCID="01a1bfaa-27f4-72da-ad88-4237879baa38"

echo "== snapshot question blocks (id | kind | required | options)"
BLOCKS_JSON=$(cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url','utf8').trim(), connectionTimeoutMillis: 15000, statement_timeout: 15000});
  await c.connect();
  const r=await c.query(\"select rendered from snapshots where document_id='$DOCID' order by built_at desc limit 1\");
  if(!r.rows.length){ console.error('NO SNAPSHOT'); process.exit(1); }
  const blocks=(r.rows[0].rendered.blocks)||[];
  const out=[];
  for(const b of blocks){
    const k=b.kind||b.type||'?';
    if(['text','divider','image'].includes(k)) continue;
    const opts=(b.options||b.props?.options||[]).map(o=>o.id);
    console.error([b.id,k,b.required?'req':'opt',opts.join(',')].join(' | '));
    out.push({id:b.id,k,req:!!b.required,opts});
  }
  console.log(JSON.stringify(out));
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
" 2>/tmp/ff7-blocks.log)
cat /tmp/ff7-blocks.log | head -8

ANSWERS=$(cd "$ROOT/packages/db" && node -e "
const blocks=JSON.parse(process.argv[1]);
const val=(k)=>{
  if(k==='short-text'||k==='shortText') return 'Ada Lovelace';
  if(k==='email') return 'ada@example.com';
  if(k==='long-text'||k==='longText'||k==='textarea') return 'Hello from logged-in QA. The conversational renderer should show this text.';
  return undefined;
};
const ans=[];
for(const b of blocks){
  const v=val(b.k);
  if(v!==undefined){ ans.push({blockId:b.id,value:v}); continue; }
  if(b.k==='single-select'||b.k==='singleSelect'||b.k==='select'){
    if(!b.opts.length){ console.error('FAIL: select has no options'); process.exit(1); }
    ans.push({blockId:b.id,value:{optionId:b.opts[0]}});
    continue;
  }
  if(b.req){ console.error('FAIL: no answer for required block '+b.id+' ('+b.k+')'); process.exit(1); }
}
console.log(JSON.stringify({answers:ans}));
" "$BLOCKS_JSON" 2>/tmp/ff7-answers.log) || { cat /tmp/ff7-answers.log; exit 1; }
echo "answers built: $(echo "$ANSWERS" | head -c 120)..."

pkill -f next-server 2>/dev/null || true; sleep 1
cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
export REDIS_URL=""
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server-fixup7.log" 2>&1 &
SRV=$!
cd "$ROOT"
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"

echo "== ingest via curl (clean output, real ids)"
START=$(curl -s -w "|%{http_code}" -X POST http://localhost:3000/api/public/ingest/submissions \
  -H "Content-Type: application/json" -d "{\"documentId\":\"$DOCID\"}")
CODE="${START##*|}"; BODY="${START%|*}"
TOKEN=$(printf '%s' "$BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
echo "start: $CODE token-len ${#TOKEN}"

if [ -n "$TOKEN" ]; then
  DONE=$(curl -s -w "|%{http_code}" -X POST "http://localhost:3000/api/public/ingest/submissions/$TOKEN/complete" \
    -H "Content-Type: application/json" -H "Idempotency-Key: qa-complete-8" -d "$ANSWERS")
  DCODE="${DONE##*|}"; DBODY="${DONE%|*}"
  echo "complete: $DCODE body: $(printf '%s' "$DBODY" | head -c 160)"
fi

echo "== verify in Neon + tidy drafts"
cd "$ROOT/packages/db" && node -e "
const {Client}=require('pg'); const fs=require('fs');
(async()=>{
  const c=new Client({connectionString: fs.readFileSync('../../scripts/.neon-db-url','utf8').trim(), connectionTimeoutMillis: 15000, statement_timeout: 15000});
  await c.connect();
  await c.query(\"delete from submissions where document_id='$DOCID' and status='draft'\");
  const s=await c.query(\"select status, count(*)::int n from submissions where document_id='$DOCID' group by 1\");
  console.log('submissions:', JSON.stringify(s.rows));
  const a=await c.query(\"select count(*)::int n from answers ans join submissions sub on sub.id=ans.submission_id where sub.document_id='$DOCID'\");
  console.log('answers for this doc:', a.rows[0].n);
  await c.end();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
" 2>&1 | grep -viE "warning|libpq|ssl|postgresql.org|^$|prepare for"
cd "$ROOT"

echo "== browser: login as new QA user, retake data shots"
ab() { agent-browser "$@"; }
ab set viewport 1440 900
ab open http://localhost:3000/login >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
ab find label "Email" fill "qa-1794216947@formforge.test" >/dev/null 2>&1
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

echo "== public page (page doc created by the main run; publish via browser fetch)"
PAGEID="01a1bfaa-82fc-7a52-953a-bebbcc0e287b"
PUB=$(ab eval "fetch('/api/v1/documents/$PAGEID/publish',{method:'POST'}).then(r=>r.json()).then(d=>'status '+r.status+' slug '+(d.slug||'?')).catch(e=>'ERR '+e.message)" 2>/dev/null | tail -1)
echo "publish: $PUB"
SLUG=$(ab eval "fetch('/api/v1/documents/$PAGEID').then(r=>r.json()).then(d=>d.slug||d.document?.slug||'none').catch(e=>'ERR')" 2>/dev/null | tail -1)
echo "slug: $SLUG"
if [ -n "$SLUG" ] && [ "$SLUG" != "none" ] && [[ "$SLUG" != ERR* ]]; then
  ab open "http://localhost:3000/p/$SLUG" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1.5
  echo "public url: $(ab get url 2>/dev/null | tail -1)"
  ab screenshot "$LOG/10-public-page.png" >/dev/null 2>&1 && echo "shot 10-public-page ok"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
fi

ab close >/dev/null 2>&1
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== pass 7 finished"
