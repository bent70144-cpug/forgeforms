"""Download failed job logs and print the tail (error region)."""
import urllib.error
import urllib.request

REPO = "bent70144-cpug/forgeforms"
TOKEN = ""
for line in open("/home/z/my-project/.env"):
    if line.startswith("GITHUB_TOKEN="):
        TOKEN = line.strip().split("=", 1)[1]

JOBS = {
    127725365955: "ci-lint",
    127725365930: "lhci-build",
    127725365686: "a11y-suite",
}

def logs(job_id):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/actions/jobs/{job_id}/logs", headers={
            "Authorization": f"token {TOKEN}", "User-Agent": "formforge-tl"})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        opener.open(req)
        raise SystemExit("expected 302")
    except urllib.error.HTTPError as e:
        if e.code not in (301, 302, 303, 307):
            raise
        target = e.headers["Location"]
    plain = urllib.request.build_opener()
    with plain.open(target) as r:
        return r.read().decode("utf-8", "replace")

for job_id, name in JOBS.items():
    text = logs(job_id)
    path = f"/tmp/log_{name}.txt"
    open(path, "w").write(text)
    print(f"### {name}: {len(text)} bytes saved to {path}")
    lines = text.splitlines()
    err_idx = [i for i, l in enumerate(lines) if "error" in l.lower() or "Error:" in l or "✖" in l or "ELIFECYCLE" in l]
    picked = set()
    for i in err_idx[:40]:
        for k in range(max(0, i - 1), min(len(lines), i + 2)):
            picked.add(k)
    for k in sorted(picked)[:80]:
        print(lines[k][:220])
    print("-----")
