# Deploying FormForge to Vercel

## Status (2026-11-09)

The provided Vercel token (`vcp_…8qd`) **authenticates** (`/v2/user` → `ash365042-4219`)
but is **not authorized for any project scope** — every project/deploy call returns:

```
403 Not authorized: Trying to access resource under scope
"ash365042-gmailcoms-projects". You must re-authenticate to this scope or
use a token with access to this scope.
```

Verified via REST (`GET /v9/projects`, `POST /v13/deployments`) and CLI
(`vercel projects ls`, `vercel deploy --prod`). No teams exist on the account,
so there is no alternate scope to target.

**Fix:** sign in to https://vercel.com as `ash365042@gmail.com`, open
**Settings → Tokens**, create a new token with full scope, then run:

```bash
VERCEL_TOKEN=<new token> ./scripts/deploy-vercel.sh
```

## What the deploy needs

| Env var | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled DSN (role `neondb_owner`, db `neondb`, host `ep-empty-lab-bb9yco0v-pooler…neon.tech`) — already in `apps/web/.env` |
| `SESSION_SECRET` / `AUTH_SECRET` | ≥32-char hex — already in `apps/web/.env` |
| `NEXT_PUBLIC_APP_URL` / `PUBLIC_BASE_URL` | the production URL after the first deploy |
| `NEXT_PUBLIC_RESULTS_MODE` | `fetch` (live results client) — already in `apps/web/.env` |
| `REDIS_URL` | omit — ingest falls back to in-memory stores (documented in `.env.example`) |

The database (Neon project `formforge`, `morning-water-20366572`, PG 17,
us-east-1) is live and reachable; the redesign was QA'd against it end-to-end.

## What shipped in this redesign

Commit `68040c3` on `main` (91 files): aurora glass design system
(dark-first tokens, violet→cyan gradients, glass chrome, Space Grotesk /
Inter / JetBrains Mono) applied to every page — landing, marketing,
auth, dashboard, builder, results, analytics, logic, AI, settings,
public/embed — with 1040 unit tests passing and a full production build green.
