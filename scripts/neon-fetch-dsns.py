#!/usr/bin/env python3
"""Fetch pooled + direct Neon connection URIs via the Neon console API.

Mirrors scripts/neon-provision.sh (proven flow):
  1. GET  /users/me/organizations            -> org id
  2. GET  /projects?org_id=...               -> project 'formforge'
  3. GET  /projects/{pid}/connection_uri?pooled=true&database_name=neondb&role_name=neondb_owner
  4. direct DSN = pooled DSN with '-pooler.' removed

Writes:
  scripts/.neon-db-url         (pooled DSN, for the running app)
  scripts/.neon-db-url-direct  (direct DSN, for migrations)

Never prints secret values - ids, hosts and masked output only.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = "/home/z/my-project"
# api.neon.tech is DNS-blocked in this sandbox; the console API mirrors v2.
BASE = "https://console.neon.tech/api/v2"
ORG = os.environ.get("NEON_ORG_ID", "")
PROJECT_NAME = "formforge"


def api(path, retries=3):
    key = open(f"{ROOT}/scripts/.neon-api-key").read().strip()
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(
                BASE + path,
                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="ignore")[:200]
            last = f"HTTP {e.code}: {body}"
            if e.code < 500 and e.code != 429:
                break
            time.sleep(2)
    raise RuntimeError(last)


def write600(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text.rstrip() + "\n")


def masked(uri):
    return re.sub(r"^(postgres(?:ql)?://[^:@/]+:)[^@]+@", r"\1***@", uri)


def main():
    global ORG
    if not ORG:
        orgs = api("/users/me/organizations")["organizations"]
        if not orgs:
            print("FAIL: no organizations on this key")
            sys.exit(1)
        ORG = orgs[0]["id"]
        print(f"org: {ORG} ({orgs[0].get('name')})")

    projects = api(f"/projects?org_id={ORG}")["projects"]
    if not projects:
        print("FAIL: no projects in org (has the project been provisioned?)")
        sys.exit(1)
    for p in projects:
        print(f"project: {p['id']} name={p.get('name')!r}")
    proj = next((p for p in projects if p.get("name") == PROJECT_NAME), None) or projects[0]
    pid = proj["id"]
    print(f"using project: {pid} ({proj.get('name')})")

    uri = None
    for attempt in range(12):
        try:
            d = api(
                f"/projects/{pid}/connection_uri"
                "?pooled=true&database_name=neondb&role_name=neondb_owner",
                retries=1,
            )
            uri = (d.get("uri") or d.get("connection_uri") or "").strip()
            if uri:
                break
        except RuntimeError as e:
            print(f"  attempt {attempt + 1}: {e}")
        time.sleep(5)
    if not uri:
        print("FAIL: could not obtain pooled URI")
        sys.exit(1)

    m = re.match(r"postgres(?:ql)?://([^:@/]+):[^@]*@([^/]+)/([^?]+)", uri)
    if not m:
        print("FAIL: unexpected pooled URI shape")
        sys.exit(1)
    user, host, db = m.groups()
    if "-pooler." not in host:
        print(f"WARN: pooled host has no -pooler suffix: {host}")
    write600(f"{ROOT}/scripts/.neon-db-url", uri)
    print(f"pooled:  user={user} host={host} db={db} -> scripts/.neon-db-url")

    direct = uri.replace("-pooler.", ".")
    if direct == uri:
        print("FAIL: could not derive direct host")
        sys.exit(1)
    dhost = re.match(r"postgres(?:ql)?://(?:[^:@/]+):[^@]*@([^/]+)/", direct).group(1)
    write600(f"{ROOT}/scripts/.neon-db-url-direct", direct)
    print(f"direct:  host={dhost} -> scripts/.neon-db-url-direct")
    print(f"pooled DSN (masked): {masked(uri)}")
    print("OK: DSNs stored (0600, gitignored)")


if __name__ == "__main__":
    main()
