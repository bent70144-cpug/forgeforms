# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in **`bent70144-cpug/forgeforms`**.

## Authentication in this environment

The `gh` CLI is **not installed** in this sandbox. All tracker operations use the GitHub REST API with `curl`:

```bash
# Load the token (stored in .env, which is gitignored — never commit or echo it)
GITHUB_TOKEN=$(grep '^GITHUB_TOKEN=' .env | cut -d= -f2-)
API=https://api.github.com/repos/bent70144-cpug/forgeforms

# List open issues
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" "$API/issues?state=open"
```

- The `gh` command examples below are the **semantic contract**; translate each to its REST endpoint (`repos/bent70144-cpug/forgeforms/...`) with the same JSON payload when running here.
- Git push uses `origin` (`https://github.com/bent70144-cpug/forgeforms.git`); authenticate a push with a one-off URL or read the token from `.env`.
- If the token is missing, expired (HTTP 401), or rate-limited (HTTP 403 with `X-RateLimit-Remaining: 0`), stop and ask the user for a fresh one. Never print the token or write it anywhere except `.env`.

## Conventions

- **Create an issue**: `POST $API/issues` with `{"title", "body", "labels": [...]}`. Use a heredoc (`--data-binary @-`) for multi-line bodies.
- **Read an issue**: `GET $API/issues/<number>` (fields: `number,title,body,labels,comments`; comments via `GET $API/issues/<n>/comments`).
- **List issues**: `GET $API/issues?state=open&per_page=100`, filter by label with `labels=<name>`; paginate with `?page=`.
- **Make an issue a sub-issue of a parent**: `POST $API/issues/<parent>/sub_issues` with `{"sub_issue_id": <child-db-id>}` (the child's **database id** from `GET $API/issues/<n>` — `.id`, not the `#number`). Without sub-issues support, put `Part of #<parent>` at the top of the child body.
- **Blocking**: where native issue dependencies are available, add with `POST $API/issues/<child>/dependencies/blocked_by` with `{"issue_id": <blocker-db-id>}`. Fallback everywhere else: a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Count open blockers**: `GET $API/issues/<n>` → `.issue_dependencies_summary.blocked_by` (open blockers only; 0 means startable). Fallback: fetch blockers listed in the body and check their state.
- **Comment on an issue**: `POST $API/issues/<n>/comments` with `{"body"}`.
- **Apply / remove labels**: `POST $API/issues/<n>/labels` with `{"labels": ["..."]}` / `DELETE $API/issues/<n>/labels/<name>`.
- **Close**: post the explanation as a comment, then `PATCH $API/issues/<n>` with `{"state": "closed"}`.

Infer the repo from `git remote -v`; in this clone it is always `bent70144-cpug/forgeforms`.

File issues only into the user's own repo. Never file into `mattpocock/skills` (the repo these skills come from) unless the user owns it. Confirm the target with the user before the first issue creation of a session if it is not `bent70144-cpug/forgeforms`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues: read with `GET $API/pulls/<n>`, list with `GET $API/pulls?state=open`, comment/label/close with the issues endpoints above (issues and PRs share one number space).

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't available, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: list the map's open children, drop any with an open blocker or an assignee; first in map order wins.
- **Claim**: `PATCH $API/issues/<n>` with `{"assignees": ["bent70144-cpug"]}` — the session's first write.
- **Resolve**: comment the answer, close the issue, then append a context pointer (gist + link) to the map's Decisions-so-far.
