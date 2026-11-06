# E2E (Playwright) — written on T07/T20, CI-gated

`logic-builder.spec.ts` covers the ticket #20 acceptance flows for the logic
builder (`/d/:docId/logic`, spec §14.1.4):

1. Canvas renders start / question / ending nodes with default-flow edges in
   document order (React Flow).
2. Clicking a node opens the rule drawer; the Start drawer hosts the hidden
   UTM-field config.
3. "If NPS ≤ 6 go to ending B, otherwise ending A": rule edits through the
   drawer autosave (PATCH `{baseRev, ops:[rule.upsert]}`) and the Saved chip
   lands within 2 s.
4. A dangling `goto` target surfaces the engine lint error **naming the rule**
   in the builder preview — the same diagnostics that block publish.
5. Autosave chip lifecycle (Saving… → Saved).

## T28 — accessibility + keyboard sweep (issue #28)

`a11y.spec.ts` and `a11y-keyboard.spec.ts` are the ticket #28 release gate
(spec §14.4 / §16 a11y row):

- **axe-core** (`@axe-core/playwright`) over the four surfaces — dashboard,
  builder (logic canvas), public page (`/p/:slug` published portfolio), public
  form (`/dev/form-plane-harness` harness — the `/p` form plane is not landed
  yet) — asserting **zero critical violations** per surface, plus a
  `prefers-reduced-motion: reduce` emulation test.
- **Keyboard sweep**: every interactive element Tab-reachable, visible focus on
  every stop, no traps; the conversational form flow is driven end-to-end with
  zero pointer events. The recorded pass + contrast audit live in
  `docs/a11y-keyboard-sweep.md`.

Both run in the CI `a11y` job (needs postgres + redis + migrations; the web
server starts via the playwright webServer, dev mode). These are NOT run in the
dev sandbox (no browsers).

## Lighthouse CI (T28, issue #28)

`lhci-seed.mjs` + root `lighthouserc.{desktop,mobile}.json` gate performance
≥ 90 desktop / ≥ 85 mobile and accessibility ≥ 90 on the published surfaces
(`/p/:slug` + harness). The CI `lhci` job builds the app, starts `next start`,
runs the seeder (register → publish designer-portfolio → runtime configs with
the live URL), then `@lhci/cli autorun` per config.

## Running

Not runnable in the dev sandbox (no Playwright browsers). In CI the `a11y` and
`lhci` jobs install chromium via `pnpm exec playwright install --with-deps`.

The T07/T20 specs are hermetic: `GET/PATCH /api/v1/documents/:id` are
intercepted with `page.route`, so no database is needed and the REAL
`ApiTransport` fetch path is exercised. The T28 a11y specs instead exercise the
real auth + documents + publish APIs, so they run with the CI postgres/redis
services (see the `a11y` job in `.github/workflows/ci.yml`).
`apps/web/tsconfig.json` and the web vitest config exclude this directory, so
the specs never leak into `pnpm -r typecheck` / `pnpm -r test`.
