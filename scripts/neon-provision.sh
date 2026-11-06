#!/usr/bin/env bash
# Provision (or reuse) a Neon Postgres project for FormForge via the Neon API.
# Token is read from scripts/.neon-token (0600). Connection strings are written to
# scripts/.neon-db-url (pooled) and scripts/.neon-db-url-direct (unpooled), both 0600
# and gitignored. NEVER prints credentials — every DB URL is masked before output.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="https://console.neon.tech/api/v2"
NT="$(cat scripts/.neon-token)"
mask() { sed -E 's#(postgres(ql)?://[^:/@]+:)[^@]+@#\1***@#g'; }
jqn() { node -e "$1"; }

echo "== Neon user =="
curl -sS --max-time 20 -H "Authorization: Bearer $NT" "$BASE/users/me" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log('login:',d.login||d.email||'(unknown)')})"

echo "== Resolve organization =="
ORG_ID=$(curl -sS --max-time 20 -H "Authorization: Bearer $NT" "$BASE/users/me/organizations" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);const o=(d.organizations||[])[0];if(o)console.log(o.id);else{console.error('no organizations found');process.exit(1)}})")
echo "org: $ORG_ID"

echo "== Existing projects =="
PROJECT_ID=""
PROJECT_ID=$(curl -sS --max-time 20 -H "Authorization: Bearer $NT" "$BASE/projects?org_id=$ORG_ID" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const d=JSON.parse(s);const p=(d.projects||[]).find(x=>x.name==='formforge');if(p)console.log(p.id)}catch{}})" || true)

if [ -n "$PROJECT_ID" ]; then
  echo "reusing existing project: $PROJECT_ID"
else
  echo "creating new project 'formforge' (Postgres 17)..."
  PROJECT_ID=$(curl -sS --max-time 60 -X POST "$BASE/projects" \
    -H "Authorization: Bearer $NT" -H "Content-Type: application/json" \
    -d "{\"project\":{\"name\":\"formforge\",\"pg_version\":17,\"org_id\":\"$ORG_ID\"}}" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);if(d.project&&d.project.id){console.log(d.project.id)}else{console.error('CREATE FAILED: '+JSON.stringify(d).slice(0,400));process.exit(1)}})")
  echo "created project: $PROJECT_ID"
fi

echo "== Fetch connection URIs =="
fetch_uri() { # $1 = extra query ("" for direct, "pooled=true" for pooler)
  local tries=0 uri=""
  while [ $tries -lt 12 ]; do
    uri=$(curl -sS --max-time 20 -H "Authorization: Bearer $NT" \
      "$BASE/projects/$PROJECT_ID/connection_uri?$1" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const d=JSON.parse(s);console.log(d.connection_uri||d.uri||'')}catch{console.log('')}})")
    if [ -n "$uri" ]; then echo "$uri"; return 0; fi
    tries=$((tries+1)); sleep 5
  done
  echo "could not obtain connection URI after retries" >&2
  return 1
}

POOLED="$(fetch_uri 'pooled=true&database_name=neondb&role_name=neondb_owner')"
DIRECT="$(fetch_uri 'database_name=neondb&role_name=neondb_owner')"

printf '%s' "$POOLED" > scripts/.neon-db-url
printf '%s' "$DIRECT" > scripts/.neon-db-url-direct
chmod 600 scripts/.neon-db-url scripts/.neon-db-url-direct

echo "== Summary (masked) =="
echo "project:      $PROJECT_ID"
echo "pooled DSN:   $(printf '%s' "$POOLED" | mask)"
echo "direct DSN:   $(printf '%s' "$DIRECT" | mask)"
echo "host(pooled): $(printf '%s' "$POOLED" | sed -E 's#.*@([^/?]+).*#\1#')"
