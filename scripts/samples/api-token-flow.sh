#!/usr/bin/env bash
# M8 acceptance sample (issue #25): create → publish → read a form using ONLY
# an API token, plus per-scope 403 checks for a read-only token.
#
# Usage:
#   BASE_URL=http://localhost:3000 TOKEN=ff_… scripts/samples/api-token-flow.sh
#
# Status (T25): the script is ready but CANNOT run end-to-end until
#   - T03/T04 land (a browser session is required to mint tokens in Settings → API tokens), and
#   - T07 lands (the documents create/publish/get handlers replace the T25 demo route).
# Once both are merged, this script is the recorded manual check for spec M8.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
: "${TOKEN:?export TOKEN=ff_<32 hex> first}"
auth=(-H "Authorization: Bearer $TOKEN" -H 'content-type: application/json')

json_field() { node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))$1"; }

echo "1) create document (docs:write)"
doc=$(curl -fsS "${auth[@]}" -d '{"type":"form","title":"Sample form"}' "$BASE_URL/api/v1/documents")
id=$(printf '%s' "$doc" | json_field '.id')
echo "   created $id"

echo "2) publish document (docs:publish)"
curl -fsS "${auth[@]}" -X POST "$BASE_URL/api/v1/documents/$id/publish" >/dev/null
echo "   published"

echo "3) read document back (docs:read)"
back=$(curl -fsS "${auth[@]}" "$BASE_URL/api/v1/documents/$id")
printf '   status=%s id=%s\n' "$(printf '%s' "$back" | json_field '.status')" "$id"

echo "4) negative: a read-only token must NOT be able to write (expect 403)"
code=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" -X POST \
  -d '{"type":"form","title":"nope"}' "$BASE_URL/api/v1/documents")
if [ "$code" = "403" ]; then echo "   ok: 403"; else echo "   FAIL: expected 403, got $code"; exit 1; fi

echo "done."
