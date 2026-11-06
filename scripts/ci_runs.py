"""Fetch latest workflow runs + failed job logs summary (token masked)."""
import json
import urllib.request

REPO = "bent70144-cpug/forgeforms"
TOKEN = ""
for line in open("/home/z/my-project/.env"):
    if line.startswith("GITHUB_TOKEN="):
        TOKEN = line.strip().split("=", 1)[1]

def api(path):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/{path}", headers={
        "Authorization": f"token {TOKEN}", "Accept": "application/vnd.github+json",
        "User-Agent": "formforge-tl"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

runs = api("actions/runs?per_page=5")["workflow_runs"]
for r in runs:
    print(f"run {r['id']} | {r['name']} | {r['head_sha'][:7]} | {r['status']}/{r['conclusion']} | {r['created_at']}")
    if r['conclusion'] != 'success' and r['status'] == 'completed':
        jobs = api(f"actions/runs/{r['id']}/jobs")["jobs"]
        for j in jobs:
            if j['conclusion'] != 'success':
                print(f"  job {j['id']} | {j['name']} | {j['conclusion']}")
                for s in j['steps']:
                    if s['conclusion'] not in ('success', 'skipped', None):
                        print(f"    step FAILED: {s['name']}")
