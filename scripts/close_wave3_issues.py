"""Close wave-3 issues (#4,#5,#7,#9,#20,#21,#24) with a resolution comment."""
import json
import os
import sys
import time
import urllib.request

REPO = "bent70144-cpug/forgeforms"
TOKEN = ""
for line in open("/home/z/my-project/.env"):
    if line.startswith("GITHUB_TOKEN="):
        TOKEN = line.strip().split("=", 1)[1]
if not TOKEN:
    sys.exit("no token")

NOTES = {
    4: "Merged via integration/wave3 → main @ 91feae0. Role matrix + requireRole, RLS on all tenant tables (idempotent 0003), tenant-scoped repos with `set local app.workspace_id`, limited `formforge_ingest` role. DoD green (1,723 tests repo-wide; cross-tenant RLS suite CI-gated).",
    5: "Merged via integration/wave3 → main @ 91feae0. Google OAuth (native, swap-in seam), forgot/reset + verify flows (sha256 single-use tokens, 1h TTL), rate limiting per IP+email, dev console transport. DoD green; e2e spec written for CI.",
    7: "Merged via integration/wave3 → main @ 91feae0. Documents CRUD + ops-based PATCH (rev/409 with current body), dashboard list/create, AutosaveController (500ms debounce, serialized queue, 409 recovery). Ops vocabulary canonical in @formforge/schema. DoD green.",
    9: "Merged via integration/wave3 → main @ 91feae0. All 8 MVP question blocks with §7.2 answer shapes, min/max/scale/clamp rules, allowOther, seeded randomize, prefill runtime. DoD green.",
    20: "Merged via integration/wave3 → main @ 91feae0. React Flow logic canvas + rule drawer, hidden fields (UTM) + prefill runtime, conversational renderer + ingest now consume the real T13 engine. Autosave via rule.upsert/rule.remove ops. DoD green.",
    21: "Merged via integration/wave3 → main @ 91feae0. 11 content blocks incl. form-embed (ff:* postMessage parent side + harness), video host allowlist, multi-question-page child-answer map, image adapter (T16 must conform to resolveImgProps surface). DoD green.",
    24: "Merged via integration/wave3 → main @ 91feae0. Domains: can() limit 402, DNS verify (Cloudflare for SaaS behind interface, manual fallback docs), middleware Host→docId fail-closed routing, settings UI. HTTPS staging check documented in docs/custom-domains.md. DoD green.",
}

def api(method, path, body=None):
    url = f"https://api.github.com/repos/{REPO}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"token {TOKEN}", "Accept": "application/vnd.github+json",
        "Content-Type": "application/json", "User-Agent": "formforge-tl"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")

for num, note in NOTES.items():
    api("POST", f"issues/{num}/comments", {"body": note})
    api("PATCH", f"issues/{num}", {"state": "closed", "state_reason": "completed"})
    print(f"#{num} closed")
    time.sleep(0.5)
print("done")
