#!/usr/bin/env bash
# Logged-in QA: production server (root checkout) + Neon Postgres + agent-browser.
# Server and ALL browser automation run inside ONE invocation — the sandbox kills
# background processes between tool calls. Secrets are never printed.
set -uo pipefail
ROOT=/home/z/my-project
LOG=$ROOT/download/redesign-qa/logged-in
mkdir -p "$LOG"

pkill -f next-server 2>/dev/null || true
sleep 1

# --- start production server (env from apps/web/.env, written by write-env-local.sh) ---
cd "$ROOT/apps/web"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue ;; esac; export "$k=$v"; done < .env
node node_modules/next/dist/bin/next start -p 3000 > "$LOG/server.log" 2>&1 &
SRV=$!
cd "$ROOT"

for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3000 && break; sleep 1; done
echo "server: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000) (pid $SRV)"

ab() { agent-browser "$@"; }
EMAIL="qa-$(date +%s)@formforge.test"
PASS="qa-passphrase-9"
DOCID=""

echo "== 1. register page"
ab set viewport 1440 900
ab open http://localhost:3000/register >/dev/null 2>&1
ab wait --load networkidle >/dev/null 2>&1
ab screenshot "$LOG/01-register.png" >/dev/null 2>&1 && echo "  shot 01-register ok"

echo "== 2. submit registration ($EMAIL)"
ab find label "Name" fill "QA Tester" >/dev/null 2>&1
ab find label "Email" fill "$EMAIL" >/dev/null 2>&1
ab find label "Password" fill "$PASS" >/dev/null 2>&1
ab find role button click --name "Create account" >/dev/null 2>&1
ab wait --url "/dashboard" --timeout 20000 >/dev/null 2>&1
echo "  landed on: $(ab get url 2>/dev/null | tail -1)"

echo "== 3. dashboard (empty)"
ab wait --load networkidle >/dev/null 2>&1
sleep 1
ab screenshot "$LOG/02-dashboard-empty.png" >/dev/null 2>&1 && echo "  shot 02-dashboard-empty ok"
ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'

echo "== 4. create-from-template modal"
ab find role button click --name "New document" >/dev/null 2>&1
sleep 1
ab screenshot "$LOG/03-create-modal.png" >/dev/null 2>&1 && echo "  shot 03-create-modal ok"
ab find role button click --name "Template" >/dev/null 2>&1
sleep 1
ab find text "Contact us" click >/dev/null 2>&1
ab find label "Name" fill "QA Contact Form" >/dev/null 2>&1
sleep 0.5
ab screenshot "$LOG/03b-create-modal-template.png" >/dev/null 2>&1
ab find role button click --name "Use template" >/dev/null 2>&1
sleep 2.5
HREF=$(ab eval "document.querySelector('a.ff-doc-title')?.getAttribute('href') || 'NONE'" 2>/dev/null | tail -1)
echo "  card href: $HREF"
DOCID=$(echo "$HREF" | sed -E 's#.*"*/d/([^/]+)/results.*#\1#')
ab screenshot "$LOG/04-dashboard-with-doc.png" >/dev/null 2>&1 && echo "  shot 04-dashboard-with-doc ok"
ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
if [ -z "$DOCID" ] || [ "$DOCID" = "NONE" ] || [ ${#DOCID} -lt 8 ]; then
  echo "  WARN: doc id not parsed ($DOCID) — remaining doc steps will be skipped"
  DOCID=""
fi

if [ -n "$DOCID" ]; then
  echo "== 5. results (empty) for $DOCID"
  ab open "http://localhost:3000/d/$DOCID/results" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/05-results-empty.png" >/dev/null 2>&1 && echo "  shot 05-results-empty ok"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'

  echo "== 6. builder"
  ab open "http://localhost:3000/d/$DOCID" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 2
  ab screenshot "$LOG/06-builder.png" >/dev/null 2>&1 && echo "  shot 06-builder ok"
  ab snapshot -i > "$LOG/builder-snapshot.txt" 2>&1
  echo "  builder interactive elements: $(grep -c 'ref=' "$LOG/builder-snapshot.txt" 2>/dev/null || echo 0)"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'

  echo "== 7. analytics (empty)"
  ab open "http://localhost:3000/d/$DOCID/analytics" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/07-analytics-empty.png" >/dev/null 2>&1 && echo "  shot 07-analytics-empty ok"

  echo "== 8. publish + ingest one submission (same-origin fetch, session cookies)"
  PUB=$(ab eval "fetch('/api/v1/documents/$DOCID/publish',{method:'POST'}).then(r=>r.text().then(t=>r.status+' '+t.slice(0,180)))" 2>/dev/null | tail -1)
  echo "  publish: ${PUB:0:190}"
  START=$(ab eval "fetch('/api/public/ingest/submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:'$DOCID'})}).then(r=>r.text())" 2>/dev/null | tail -1)
  echo "  start: ${START:0:150}"
  TOKEN=$(echo "$START" | sed -E 's/.*"token":"([^"]+)".*/\1/')
  if [ -n "$TOKEN" ] && [ ${#TOKEN} -lt 100 ]; then
    DONE=$(ab eval "fetch('/api/public/ingest/submissions/$TOKEN/complete',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'qa-complete-1'},body:JSON.stringify({answers:[{blockId:'name',value:'Ada Lovelace'},{blockId:'email',value:'ada@example.com'},{blockId:'topic',value:'topic-o1'},{blockId:'message',value:'Hello from logged-in QA. The conversational renderer should show this text.'}]})}).then(r=>r.text())" 2>/dev/null | tail -1)
    echo "  complete: ${DONE:0:190}"
  else
    echo "  WARN: no token from ingest start — skipping complete"
  fi

  echo "== 9. results + analytics with data"
  ab open "http://localhost:3000/d/$DOCID/results" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/08-results-data.png" >/dev/null 2>&1 && echo "  shot 08-results-data ok"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
  ab open "http://localhost:3000/d/$DOCID/analytics" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/09-analytics-data.png" >/dev/null 2>&1 && echo "  shot 09-analytics-data ok"
fi

echo "== 10. page doc -> public scroll plane"
PDOC=$(ab eval "fetch('/api/v1/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'page',title:'QA Landing Page'})}).then(r=>r.text())" 2>/dev/null | tail -1)
PAGEID=$(echo "$PDOC" | sed -E 's/.*"id":"([^"]+)".*/\1/')
PAGESLUG=$(echo "$PDOC" | sed -E 's/.*"slug":"([^"]+)".*/\1/')
echo "  page doc id: $PAGEID slug: $PAGESLUG"
if [ -n "$PAGEID" ] && [ ${#PAGEID} -lt 100 ]; then
  ab eval "fetch('/api/v1/documents/$PAGEID/publish',{method:'POST'}).then(r=>r.status)" 2>/dev/null | tail -1 | sed 's/^/  publish status: /'
  ab open "http://localhost:3000/p/$PAGESLUG" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/10-public-page.png" >/dev/null 2>&1 && echo "  shot 10-public-page ok"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
fi

echo "== 11. settings pages"
for pair in "billing:11-settings-billing" "tokens:12-settings-tokens" "domains:13-settings-domains"; do
  route="${pair%%:*}"; name="${pair##*:}"
  ab open "http://localhost:3000/settings/$route" >/dev/null 2>&1
  ab wait --load networkidle >/dev/null 2>&1; sleep 1
  ab screenshot "$LOG/$name.png" >/dev/null 2>&1 && echo "  shot $name ok"
  ab errors 2>&1 | tail -2 | sed 's/^/  page-err: /'
done

echo "== 12. auth guard: cleared cookies + /dashboard must bounce to /login"
ab cookies clear >/dev/null 2>&1
ab open http://localhost:3000/dashboard >/dev/null 2>&1
sleep 2
echo "  final url: $(ab get url 2>/dev/null | tail -1)"
ab screenshot "$LOG/14-guard-login.png" >/dev/null 2>&1 && echo "  shot 14-guard-login ok"

ab close >/dev/null 2>&1
kill $SRV 2>/dev/null || true
pkill -f next-server 2>/dev/null || true
echo "== QA run finished; artifacts in download/redesign-qa/logged-in"
