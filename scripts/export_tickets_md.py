#!/usr/bin/env python3
"""Generate docs/tickets.md — master index of the 29 FormForge tickets + issue links."""
import sys
sys.path.insert(0, "/home/z/my-project/scripts")
from tickets_a import T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15
from tickets_b import T16, T17, T18, T19, T20, T21, T22, T23, T24, T25, T26, T27, T28, T29

TICKETS = sorted([v for k, v in list(globals().items()) if k.startswith("T") and k[1:].isdigit()], key=lambda t: t["n"])
REPO = "https://github.com/bent70144-cpug/forgeforms"

lines = [
    "# FormForge — Ticket Index",
    "",
    "Source of truth for scope: [`spec.md`](../spec.md). Authoritative ticket bodies live as GitHub issues",
    f"in [{REPO.replace('https://','')}]({REPO}/issues) (issues #1–#29, native blocking edges + `ready-for-agent`).",
    "This file is the generation source: `scripts/tickets_a.py` + `scripts/tickets_b.py`,",
    "published by `scripts/publish_tickets.py`.",
    "",
    "| # | Issue | Title | Blocked by |",
    "|---|-------|-------|------------|",
]
for t in TICKETS:
    blocks = ", ".join(f"[#{b}]({REPO}/issues/{b})" for b in t["blocked"]) if t["blocked"] else "— (frontier)"
    lines.append(f"| T{t['n']:02d} | [#{t['n']}]({REPO}/issues/{t['n']}) | {t['title']} | {blocks} |")

lines += [
    "",
    "## Working the graph",
    "",
    "- **Frontier** = tickets whose blockers are all closed. Currently: T01.",
    "- Implementer agents work one ticket per **worktree + branch** (`ticket/<nn>-<slug>`),",
    "  merge integration tip into their branch before reporting, and never push.",
    "- **`main` is the integration branch**: merges are done by the lead session only,",
    "  auto-pushed to GitHub every 20 minutes (`scripts/auto-push.sh`).",
    "- When a ticket merges to `main`, its issue is closed with a merge-comment.",
    "",
    "## Suggested first waves",
    "",
    "1. `T01` → 2. `T02` → 3. `T03` ∥ `T06` → 4. `T04` ∥ `T05` ∥ `T07` ∥ `T13` …",
    "",
]
open("/home/z/my-project/docs/tickets.md", "w").write("\n".join(lines))
print(f"wrote docs/tickets.md with {len(TICKETS)} tickets")
