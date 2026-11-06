# E2E (Playwright) — written on T20, CI-gated

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

## Running

Not runnable in the dev sandbox (no Playwright browsers; `@playwright/test` is
intentionally not in package.json — see playwright.config.ts header). In CI:

```sh
pnpm add -D -w @playwright/test
pnpm exec playwright install --with-deps
pnpm exec playwright test --config apps/web/e2e/playwright.config.ts
```

The suite is hermetic: `GET/PATCH /api/v1/documents/:id` are intercepted with
`page.route`, so no database is needed and the REAL `ApiTransport` fetch path
is exercised. `apps/web/tsconfig.json` and the web vitest config exclude this
directory, so the specs never leak into `pnpm -r typecheck` / `pnpm -r test`.
