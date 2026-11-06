#!/usr/bin/env python3
"""Publish FormForge tickets to GitHub Issues (bent70144-cpug/forgeforms)."""
import json, sys, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts")
from tickets_a import T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15
from tickets_b import T16, T17, T18, T19, T20, T21, T22, T23, T24, T25, T26, T27, T28, T29

TOKEN = [l.split("=", 1)[1].strip() for l in open("/home/z/my-project/.env") if l.startswith("GITHUB_TOKEN=")][0]
API = "https://api.github.com/repos/bent70144-cpug/forgeforms"
HDR = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json", "User-Agent": "formforge-setup"}

def req(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(f"{API}{path}", data=data, headers=HDR, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

TICKETS = sorted([v for k, v in globals().items() if k.startswith("T") and k[1:].isdigit()], key=lambda t: t["n"])
assert [t["n"] for t in TICKETS] == list(range(1, 30)), "ticket numbering broken"

def body_md(t):
    lines = ["## What to build", "", t["build"], "", "## Acceptance criteria", ""]
    lines += [f"- [ ] {a}" for a in t["accept"]]
    lines += ["", "## Blocked by", ""]
    if t["blocked"]:
        lines += [f"- #{b}" for b in t["blocked"]]
    else:
        lines += ["- None (can start immediately)"]
    lines += ["", "_Reference `spec.md` at repo root for full context. Follow the pinned stack (§1) and module contract (§3)._"]
    return "\n".join(lines)

created = {}
for t in TICKETS:
    code, data = req("POST", "/issues", {"title": f"[T{t['n']:02d}] {t['title']}", "body": body_md(t), "labels": ["ready-for-agent"]})
    if code != 201:
        print(f"FAIL create T{t['n']}: HTTP {code} {data.get('message')}"); sys.exit(1)
    num = data["number"]
    if num != t["n"]:
        print(f"WARN: T{t['n']} landed as issue #{num}")
    created[t["n"]] = {"number": num, "db_id": data["id"], "title": t["title"]}
    print(f"T{t['n']:02d} -> issue #{num}")

# native blocking edges (best effort)
ok = fail = 0
for t in TICKETS:
    for b in t["blocked"]:
        code, _ = req("POST", f"/issues/{created[t['n']]['number']}/dependencies/blocked_by", {"issue_id": created[b]["db_id"]})
        ok, fail = (ok + 1, fail) if code in (201, 200) else (ok, fail + 1)
print(f"dependency edges: {ok} ok, {fail} failed (body 'Blocked by' lines are authoritative fallback)")
print("DONE: 29 tickets published" if len(created) == 29 else "INCOMPLETE")
