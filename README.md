# FormForge

Multi-tenant SaaS for **forms, landing pages and portfolios** on one block-document model.
The build spec is the source of truth: [`spec.md`](./spec.md).

## Quickstart (local)

```bash
docker compose up -d          # postgres 16 + redis 7 + minio
cp .env.example .env          # fill secrets as needed
pnpm install
pnpm dev                      # web (Next.js, :3000) + worker (BullMQ) in parallel
```

## Repository layout

See spec §2. In short: `apps/web` (Next.js 15 App Router), `apps/worker` (BullMQ),
`packages/{core,schema,db,blocks,renderer,ui,config}`.

## Agent workflow

- Tickets live as GitHub issues #1–#29 with blocking edges (see [`docs/tickets.md`](./docs/tickets.md)).
- Implementation happens one ticket per git worktree + branch `ticket/<nn>-<slug>`.
- `main` is the integration branch: merges are done by the lead session only.
