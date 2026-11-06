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

## Builder specs (wave 3a, task 8-b) — `builder.spec.ts`

The three-pane builder page (`/d/:docId`, spec §4–§8) is covered by
`builder.spec.ts` (shared helpers in `builder-helpers.ts`). Ten serial
describe blocks (a11y.spec.ts-style `describe.configure({ mode: "serial" })`)
tell the builder story in order; every test seeds and opens its own instance,
so a failure stops the narrative without corrupting later state:

1. **builder opens** — real dashboard flow (register → create-modal blank
   Form → open `/d/:id`): shell, top bar (back link, inline title, Saved
   chip), the three panes, empty canvas/tree, publish gate already in
   `Fix 2 issues` — and **zero console errors** (benign dev noise filtered).
2. **add blocks via picker** — left-pane "Add block" → palette dialog
   (search "email" → Enter inserts); canvas "+" insertion row → the same
   picker anchored at root index 0 (wave 3 made the picker the single
   insertion surface — the wave-1 quick-menu fallback was removed); tree
   order asserted after each insert.
3. **edit inline + settings** — inline label edit (Enter commits), block
   editor in the right pane, Required toggle → Saved chip ≤ 3 s, and the
   route-mocked PATCH really carried a `block.update` op.
4. **reorder keyboard** — Alt+ArrowDown moves the focused block (tree order
   asserted), Ctrl/Cmd+Z restores.
5. **undo/redo + delete toast** — toolbar delete → `undo-toast` with the
   block label → Undo restores within the 8 s window → Cmd/Ctrl+Shift+Z
   redoes the delete (toast must NOT reappear).
6. **preview** — "Draft preview" dialog (DRAFT chip), Restart, Esc close.
7. **publish gate** — empty form → `Fix 2 issues` opens the IssuesList
   drawer (`NO_QUESTIONS` + `NO_ENDING` chips, count line); quick-add a
   question + ending via the UI → button returns to enabled `Publish`.
   Client-side gate state only — the publish POST is never asserted.
8. **theme** — Slate Dark preset (`data-preset-id="slate-dark"`,
   aria-pressed) repaints the canvas `--ff-bg`. Currently self-skips at
   runtime: no shipped control dispatches `setPanel("theme")` yet, so the
   test skips until the right-pane opener lands (see the in-file note).
9. **keyboard map** — "?" opens the shortcuts dialog (Esc closes);
   Cmd/Ctrl+K opens the block picker.
10. **a11y spot** — axe scan of the three-pane builder, zero critical
    violations (same gate as a11y.spec.ts).

### Running

```bash
pnpm --filter @formforge/web exec playwright install --with-deps   # CI only
pnpm --filter @formforge/web exec playwright test -c e2e/playwright.config.ts e2e/builder.spec.ts
```

### Prerequisites / modes

- **Test 1 needs the real stack** (like documents.spec.ts): register/login
  hit the identity tables, so the CI Postgres/Redis services must be up.
  There is no storageState reuse — every run registers a fresh user.
- **Tests 2–10 are hermetic** (like logic-builder.spec.ts):
  `GET/PATCH /api/v1/documents/builder-e2e` are intercepted with
  `page.route`, so no database is needed and the REAL `ApiTransport` +
  autosave loop are exercised. They must run in **API mode** — the suite
  skips itself when `NEXT_PUBLIC_FF_MOCK_BUILDER=1` is visible (the
  in-memory MockTransport would serve a different document and never touch
  the intercepted routes).
- The keyboard/picker tests assume the wave-3 integration mounts
  `useShortcuts` + `useBlockPicker` on the builder page (the emitters/
  consumers ship with the components; only the page-level wiring is in
  flight).
- Known integration findings the suite encodes around (for wave 3b):
  `UndoToast` is mounted twice (BuilderShell **and** BuilderPage), so the
  delete-toast test addresses the top-most instance via `.last()` and its
  hidden-state assertions pin the §6.4 single-toast contract; and no shipped
  control opens the Theme panel yet (`setPanel("theme")` has no call site),
  so the theme test self-skips until the right-pane opener lands.

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
