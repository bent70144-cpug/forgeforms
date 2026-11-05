# AGENTS.md

Guidance for AI agents working in this repository.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at **`bent70144-cpug/forgeforms`** (this repo's `origin`). The `gh` CLI is not installed in this environment — use `curl` against the REST API with `GITHUB_TOKEN` from `.env`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
