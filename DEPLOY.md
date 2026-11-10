# Deploying FormForge to Vercel

## Status (2026-11-10) — DEPLOYED ✅

Production is live at **https://formforge-livid.vercel.app** serving the
Meridian editorial redesign (commit `915c9be`).

Deployment `formforge-ll7xi0trz` (CLI upload from repo root, aliased to
`formforge-livid.vercel.app`). Post-deploy verification:

- all key routes `200` (`/`, `/login`, `/register`, `/forgot`, `/templates`,
  `/embed`, `/report-abuse`, `/dpa`); `/dashboard` correctly `307`s to login
- DB-backed public route `/p/[slug]` returns a styled `404` (previously
  `500` — see env fix below)
- served CSS carries the Meridian system: Sora display face,
  `--font-display` / `--font-body`, `--ink` / `--accent` tokens
- visual check via headless browser: landing, login and templates pages all
  render the paper/ink/ultramarine editorial design

## Environment fix (2026-11-10)

The project's runtime env vars were empty on Vercel, which broke every
DB-backed route in production (HTTP 500). Fixed by:

1. Rotating the Neon `neondb_owner` password via the Neon API
   (`POST /v2/projects/…/roles/neondb_owner/reset_password`) and building
   the pooled DSN (`ep-empty-lab-bb9yco0v-pooler.c-15.us-east-1.aws.neon.tech`).
2. Recreating `DATABASE_URL`, `SESSION_SECRET`, `AUTH_SECRET`,
   `NEXT_PUBLIC_APP_URL`, `PUBLIC_BASE_URL` on the Vercel project via the
   REST API (`POST /v9/projects/{id}/env`; the API rejects upserts, so
   delete-then-create).

Secrets live in the Vercel project env and the gitignored
`apps/web/.env` — never in the repo.

## Deploy procedure (works as of 2026-11-10)

```bash
# link the REPO ROOT to the formforge project (apps/web is built via the
# project's Root Directory setting — CLI deploys from apps/web/ itself
# upload only that subtree and fail on missing workspace packages)
cat > .vercel/project.json <<'EOF'
{"projectId":"prj_6LmiNvExx0l4z4yyfZYpAr6j82tn","orgId":"team_qyfSwpghWuSxv2MonHtbDer1"}
EOF

# build check locally, then deploy from the repo root
pnpm install --frozen-lockfile
pnpm --filter @formforge/web build
npx vercel@latest deploy --prod --yes --token="$VERCEL_TOKEN"
```

Requirements:

| Env var | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled DSN (role `neondb_owner`, db `neondb`) — set on the Vercel project |
| `SESSION_SECRET` / `AUTH_SECRET` | ≥32-char hex — set on the Vercel project |
| `NEXT_PUBLIC_APP_URL` / `PUBLIC_BASE_URL` | `https://formforge-livid.vercel.app` |
| `NEXT_PUBLIC_RESULTS_MODE` | `fetch` (live results client) |
| `REDIS_URL` | omit — ingest falls back to in-memory stores (documented in `.env.example`) |

## Redesign history

- `68040c3` aurora glass design system (dark-first, violet→cyan gradients,
  Space Grotesk / Inter / JetBrains Mono) — 91 files, 1040 unit tests green
- `9d9aaa4` + `915c9be` Meridian editorial system (paper/ink/ultramarine,
  Sora display face) — every page reskinned; this is what ships today

The earlier token-scope blocker (v1 token authenticating but not authorized
for the `ash365042-gmailcoms-projects` scope) is resolved: the current token
has full project scope. CLI deploys must run from the **repo root** with the
`.vercel/project.json` link above — deploying from `apps/web/` creates a
broken standalone project (seen live: stray `web` project, failed `npm
install` on missing workspace packages).
