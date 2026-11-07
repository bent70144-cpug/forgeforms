# Wave 4 build report (`docs/wave4-build-report.md`)

Per-agent report for **wave 4 (agent build)** — 13 parallel packages, one per
builder-audit follow-up (see [`docs/builder-audit.md`](./builder-audit.md),
§4 follow-ups and the "Wave 4 update" section). Each section below pins what
the package is supposed to deliver; the **Result** fields are intentionally
**empty** — the lead integrator fills them in during merge verification
(pass/fail per gate, commit range, and any deviations from the expected
file list).

## How this wave was run

- **Worktree per agent.** Every agent works in its own git worktree off the
  shared merge-base commit `93cda2d` ("Merge remote main (UI consistency
  pass)"), on exactly one branch `agent/w<n>-<slug>`, committing only to that
  branch. No agent touches another worktree, pushes, or rebases.
- **Isolation rule.** Only W13 (docs/e2e) may edit shared docs
  (`docs/builder-audit.md`, this report, the root `README.md` Builder section)
  and `apps/web/e2e/*`; every other package stays inside its code area.
- **Suggested merge order.** Data-loss-risk order first (§20 guidance), spec
  gaps after, docs last:
  1. W1 (stale-batch conflict flow) → W2 (401 re-auth) → W3 (publish-gate
     codes) → W4 (slug check) — the never-lose-work / publish-integrity chain;
  2. W5 (text block) → W6 (dnd drag) → W7 (entitlements) → W8 (telemetry) →
     W9 (hard limits) — capability + performance;
  3. W10 (option-list keyboard) → W11 (§9.2 editor gaps) → W12 (asset
     picker) — block-editor polish;
  4. W13 (docs + e2e cases) **last** — its spec cases assert W1/W2/W4/W6/W12
     behavior, so they should be tightened/verified on the integration branch
     after the code packages land.
- **Gates per merge** (lead integrator runs after each merge, and for the
  final `agent/build-wave4` state):
  `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` →
  `pnpm test` → `pnpm --filter @formforge/web typecheck` → e2e (see
  "E2E status (W13 sandbox attempt)" below; full e2e needs the docker compose
  services and is CI-gated).
- **Status vocabulary.** A package is *verified* only when all gates above are
  green on the integration branch after its merge; otherwise record what
  failed in its Result field and reference the re-audit
  ([`docs/builder-audit.md`](./builder-audit.md) "Wave 4 update").

---

## W1 — stale offline batches → §7.3 conflict flow

- **Branch:** `agent/w1-conflict-flow`
- **Follow-up ref:** §4 #2
- **Scope:** wire `wiring.planRecovery`'s stale path (`baseRev < serverRev`)
  into the §7.3 conflict flow instead of the discard-only RestorePrompt, so a
  stored §22.2 offline batch that predates the loaded rev can still be merged
  ("Keep mine" / "Use theirs") instead of silently discardable.
- **Acceptance criteria:**
  - A stale record triggers the §7.3 dialog (blocking, non-destructive;
    Escape does not dismiss).
  - "Keep mine" re-sends the local ops against the server rev; "Use theirs"
    adopts the server document and clears the §22.2 record.
  - Existing `planRecovery` unit semantics stay covered; no data loss on any
    resolution path.
- **Files expected** (touchpoints; confirm at merge):
  `apps/web/lib/builder/wiring.ts`, `apps/web/components/builder/RestorePrompt.tsx`,
  `apps/web/components/builder/BuilderPage.tsx` + their tests
  (`wiring.test.ts`, `RestorePrompt.test.tsx`).
- **Verification command:** `pnpm --filter @formforge/web test -- wiring RestorePrompt autosave && pnpm --filter @formforge/web typecheck`
- **E2E case:** `builder.spec.ts` describe 11 (self-skips until this merges).
- **Result:** _(empty — fill after merge verification)_

## W2 — 401 re-auth prompt in the autosave loop

- **Branch:** `agent/w2-reauth-401`
- **Follow-up ref:** §4 #3
- **Scope:** detect `status === 401` in `AutosaveController`, park the queue
  (offline-style), raise a re-auth prompt (not the generic "Couldn't save —
  Retry"), and resume the flush on re-auth without losing pending ops.
- **Acceptance criteria:**
  - 401 parks pending ops and shows the prompt; no retry storm.
  - Pending ops survive the prompt (mirrored to the §22.2 record) and flush
    after re-auth.
  - Non-401 error behavior is unchanged.
- **Files expected:** `apps/web/lib/builder/autosave.ts`, a new prompt
  component under `apps/web/components/builder/`, `BuilderPage.tsx` wiring +
  `autosave.test.ts` / component test.
- **Verification command:** `pnpm --filter @formforge/web test -- autosave && pnpm --filter @formforge/web typecheck`
- **E2E case:** `builder.spec.ts` describe 12 (self-skips until this merges).
- **Result:** _(empty — fill after merge verification)_

## W3 — publish-gate codes FORM_EMBED_MISSING + MISSING_ASSET

- **Branch:** `agent/w3-publish-codes`
- **Follow-up ref:** §4 #4
- **Scope:** add the two missing §8.1 gate codes so a `form-embed` pointing at
  an unpublished/deleted document or a deleted asset blocks publishing, with
  drawer entries + "Go to" navigation in IssuesList.
- **Acceptance criteria:**
  - `FORM_EMBED_MISSING` fires when the embedded document is unpublished,
    archived or missing.
  - `MISSING_ASSET` fires when a referenced asset id no longer resolves.
  - Both render in the IssuesList drawer with stable `data-code` hooks.
- **Files expected:** `apps/web/lib/builder/publish.ts` (validation),
  `apps/web/components/builder/IssuesList.tsx`, `PublishControl.tsx` +
  `publish.test.ts` / `IssuesList.test.tsx`.
- **Verification command:** `pnpm --filter @formforge/web test -- publish IssuesList && pnpm --filter @formforge/web typecheck`
- **Result:** _(empty — fill after merge verification)_

## W4 — slug availability endpoint + taken suggestion

- **Branch:** `agent/w4-slug-check`
- **Follow-up ref:** §4 #5
- **Scope:** add `GET /api/v1/documents/:id/slug-check?slug=…`, a debounced
  (~500 ms) probe in DocSettings next to the format check, and on "taken" an
  inline error plus a clickable `-2` variant suggestion (§6.6/§22.1/§14).
- **Acceptance criteria:**
  - Route answers `{ slug, available, suggestions? }` scoped to the workspace
    (the document's own slug is available).
  - DocSettings probes debounced, shows the taken error and the suggestion;
    clicking the suggestion fills the field.
  - Format validation behavior is unchanged when the probe is unreachable.
- **Files expected:** new route `apps/web/app/api/v1/documents/[id]/slug-check/route.ts`
  (+ route test), `apps/web/components/builder/settings/DocSettings.tsx`,
  `settings-helpers.ts` (+ settings tests).
- **Verification command:** `pnpm --filter @formforge/web test -- settings slug && pnpm --filter @formforge/web typecheck`
- **E2E case:** `builder.spec.ts` describe 13 (self-skips until this merges).
- **Result:** _(empty — fill after merge verification)_

## W5 — text block registry def + rich text editor

- **Branch:** `agent/w5-text-block`
- **Follow-up ref:** §4 #6
- **Scope:** land the `text` block registry definition (schema props, builder
  editor, renderer) with a rich text editor — Tiptap lazy-loaded per §13, or a
  documented fallback if Tiptap is rejected — plus the allowlist sanitizer
  integration so `text` stops rendering as UnknownBlock.
- **Acceptance criteria:**
  - `text` appears in the palette and renders on canvas + public plane.
  - Stored HTML passes the sanitizer; §13 lazy-load respected (no Tiptap in
    the initial builder bundle).
  - If the fallback editor shipped instead of Tiptap, that decision is
    recorded in the Result field.
- **Files expected:** `packages/blocks` (text def/editor/renderer),
  sanitizer wiring in `packages/core`, registry consumers in
  `apps/web/components/builder/`.
- **Verification command:** `pnpm --filter @formforge/blocks test && pnpm --filter @formforge/web test -- BlockPicker Canvas && pnpm typecheck`
- **Result:** _(empty — fill after merge verification)_

## W6 — dnd-kit pointer/touch drag + drop indicator + auto-scroll

- **Branch:** `agent/w6-dnd-drag`
- **Follow-up ref:** §4 #7
- **Scope:** dnd-kit pointer/touch drag reorder on the canvas (§6.2) with a
  drop indicator, auto-scroll, Esc-cancel, reusing the existing move
  announcement seam (`announce()`); keep the keyboard Alt+Arrow path intact.
- **Acceptance criteria:**
  - Pointer drag reorders and dispatches a coalesced `block.move`.
  - Drop indicator visible during drag; auto-scroll at container edges;
    Esc cancels without mutation.
  - §13 drag-budget profiling noted in the Result field (measured or
    explicitly deferred).
- **Files expected:** `apps/web/components/builder/Canvas.tsx`,
  `BlockCard.tsx` (drag handle), `BlocksTree.tsx`, new dnd wiring module +
  component tests.
- **Verification command:** `pnpm --filter @formforge/web test -- canvas BlockCard && pnpm --filter @formforge/web typecheck`
- **E2E case:** `builder.spec.ts` describe 15 (self-skips until this merges).
- **Result:** _(empty — fill after merge verification)_

## W7 — entitlements surface for builder gates + 402/403 explanations

- **Branch:** `agent/w7-entitlements`
- **Follow-up ref:** §4 #8
- **Scope:** resolve `can()` client-side (permissions carried on the GET
  envelope) so `remove_branding`, `file_upload_max_mb`, `custom_redirect`,
  `notify_emails_limit` become real gates instead of the static §24 notes,
  and 402/403 answers render inline explanations (§14).
- **Acceptance criteria:**
  - Gates derive from envelope permissions, not static placeholders.
  - A 402/403 on PATCH/publish surfaces an inline explanation in the panel.
- **Files expected:** entitlement resolution in `apps/web/lib/builder/` (or a
  new `lib/entitlements` seam), gate consumers in `SettingsPanel`/`DocSettings`,
  `PublishControl.tsx` + tests.
- **Verification command:** `pnpm --filter @formforge/web test -- entitlements billing SettingsPanel && pnpm --filter @formforge/web typecheck`
- **Result:** _(empty — fill after merge verification)_

## W8 — telemetry sink + §15 builder event vocabulary

- **Branch:** `agent/w8-telemetry`
- **Follow-up ref:** §4 #9
- **Scope:** replace the console stub with a real telemetry collector and
  instrument the §15 builder vocabulary — `autosave_ok {opsCount, ms}` first,
  then the remaining §15 builder events.
- **Acceptance criteria:**
  - `autosave_ok` fires per successful flush with `{opsCount, ms}`.
  - The sink is fail-open (never throws into the autosave loop) and
    dev-noise-safe.
  - §15 event names match the spec vocabulary.
- **Files expected:** `apps/web/lib/telemetry.ts` (+ collector/sink),
  instrumentation in `lib/builder/autosave.ts` / store, `telemetry.test.ts`.
- **Verification command:** `pnpm --filter @formforge/web test -- telemetry autosave && pnpm --filter @formforge/web typecheck`
- **Result:** _(empty — fill after merge verification)_

## W9 — 500-block/1 MB client hard limits + virtualized BlocksTree

- **Branch:** `agent/w9-hard-limits`
- **Follow-up ref:** §4 #10a
- **Scope:** client-side insertion guard at 500 blocks / 1 MB JSON with the
  §14 explanation (insertion disabled, not silent), and virtualization of the
  left `BlocksTree` above ~200 rows (§13 techniques list).
- **Acceptance criteria:**
  - Insertion attempts past a limit are disabled with an explanation; no
    crash and no silent truncation.
  - Tree stays responsive above 200 rows (virtualization) without breaking
    the roving-tabindex/announcement contract (§12).
- **Files expected:** `apps/web/lib/builder/ops.ts` or store guard,
  `apps/web/components/builder/BlocksTree.tsx`, `LeftPane.tsx` + tests.
- **Verification command:** `pnpm --filter @formforge/web test -- BlocksTree ops store && pnpm --filter @formforge/web typecheck`
- **Result:** _(empty — fill after merge verification)_

## W10 — option-list keyboard interactions (§9.3)

- **Branch:** `agent/w10-option-list`
- **Follow-up ref:** §4 #10b
- **Scope:** shared option-list keyboard interactions across list-style block
  editors: Enter-add, Backspace-delete, paste-split (multi-line paste creates
  one option per line), and duplicate-entry warning.
- **Acceptance criteria:**
  - Enter adds, Backspace deletes the focused entry, paste splits on
    newlines, duplicates warn without blocking.
  - The interaction contract lives in ONE shared hook/helper (spec: "shared
    option-list" behavior), reused by every list editor.
- **Files expected:** `packages/blocks` list editors (multi-select, dropdown,
  single-select) or a shared helper under `packages/blocks/src/shared/` +
  editor tests.
- **Verification command:** `pnpm --filter @formforge/blocks test && pnpm typecheck`
- **Result:** _(empty — fill after merge verification)_

## W11 — §9.2 editor gaps (dropdown/single-select/rating/columns/form-embed)

- **Branch:** `agent/w11-editor-gaps`
- **Follow-up ref:** spec gap §9.2 (not a numbered audit follow-up)
- **Scope:** dropdown bulk-paste, single-select display-mode, rating number
  icon, columns ratios/stack order, and form-embed layout/height modes.
- **Acceptance criteria:**
  - Each §9.2 item is implemented per spec with editor + renderer parity.
  - Props stay schema-valid (no DocumentBody rejections introduced).
- **Files expected:** `packages/blocks` editors/renderers for `dropdown`,
  `single-select`, `rating`, `columns`, `form-embed` + tests.
- **Verification command:** `pnpm --filter @formforge/blocks test && pnpm --filter @formforge/renderer test && pnpm typecheck`
- **Result:** _(empty — fill after merge verification)_

## W12 — asset picker modal (upload/library) + §9.1 question image field

- **Branch:** `agent/w12-asset-picker`
- **Follow-up ref:** spec gap §10 (+ §9.1 image field)
- **Scope:** asset picker modal with upload + library tabs (§10) and the
  question image field (§9.1) that opens it; lazy-loaded per §13.
- **Acceptance criteria:**
  - Upload path produces a usable asset (presigned flow) without leaving the
    picker; library lists workspace assets with pagination/empty states.
  - Selecting an asset fills the question image field; the picker never
    touches a real bucket in e2e (route-mocked).
- **Files expected:** new `apps/web/components/builder/AssetPicker*` (modal),
  `BlockSettings.tsx` image field wiring, `apps/web/lib/assets` client.
- **Verification command:** `pnpm --filter @formforge/web test -- AssetPicker BlockSettings && pnpm --filter @formforge/web typecheck`
- **E2E case:** `builder.spec.ts` describe 14 (self-skips until this merges).
- **Result:** _(empty — fill after merge verification)_

## W13 — docs + e2e attempt (this package)

- **Branch:** `agent/w13-docs-e2e`
- **Follow-up ref:** §4 #1 (+ this wave's docs)
- **Scope:** attempt to run the documented Playwright flow in the sandbox;
  add wave-4 e2e spec cases (builder.spec.ts describes 11–15); write the wave
  docs (builder-audit "Wave 4 update", this report, README Builder section).
- **Acceptance criteria:**
  - E2E attempt recorded with exact commands + outcomes (below) — no faked
    results.
  - New spec cases self-skip (with the owning branch named) until their
    package merges; suite collects cleanly (15 tests in builder.spec.ts).
  - Docs render sensibly, links resolve, no other agent's subject touched, no
    status flips.
- **Files changed:** `apps/web/e2e/builder.spec.ts`,
  `apps/web/e2e/README.md`, `docs/builder-audit.md`, this file, `README.md`.
- **Verification command:** `pnpm --filter @formforge/web typecheck && pnpm --filter @formforge/web exec playwright test -c e2e/playwright.config.ts e2e/builder.spec.ts --list`
- **Result:** _(empty — fill after merge verification)_

### E2E status (W13 sandbox attempt)

Recorded verbatim (2025 wave-4 sandbox; nothing below is extrapolated):

| # | Command | Outcome |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | OK (1.9 s, warm store, 404 packages) |
| 2 | `pnpm --filter @formforge/web exec playwright install chromium` | OK — chromium 156.0.8078.4 + headless shell + ffmpeg downloaded to `~/.cache/ms-playwright` (network available) |
| 3 | `docker --version` / `docker compose version` | FAILED — `docker: command not found`; the README's `docker compose up -d` prerequisite (postgres 16 + redis 7 + minio) cannot be satisfied in this sandbox |
| 4 | `pnpm --filter @formforge/web exec playwright test -c e2e/playwright.config.ts e2e/builder.spec.ts` (README command, slash-filtered filter form) | Test 1 (real API) FAILED: register stayed on `/register` — the identity API cannot reach Postgres (no services). Tests 2–10 "did not run" (serial mode aborts the narrative after a failure). Web server + chromium boot fine. |
| 5 | Same command + `--grep-invert "builder opens"` (hermetic 2–10 only) | Test 2 FAILED at `openBuilder`: `goto /d/builder-e2e` lands on the **login page** — `app/(app)/layout.tsx` server-redirects unauthenticated users (`if (!session) redirect("/login")`), so the hermetic route-mocked cases still need a real session. Tests 3–10 did not run (serial abort). |
| 6 | `pnpm --filter @formforge/web exec playwright test -c e2e/playwright.config.ts e2e/builder.spec.ts --list` | OK — 15 tests collected (10 existing + 5 wave-4 cases). |

**Why e2e cannot fully run here:** two independent infrastructure gaps —

1. **No docker → no Postgres/Redis.** Registration/login (test 1, a11y
   specs, documents.spec.ts) need the identity tables; the compose stack
   cannot start without the docker binary.
2. **The "hermetic" builder cases need a session anyway.** They intercept
   `GET/PATCH /api/v1/documents/:id` in the browser, but the `/d/:docId`
   route is gated server-side by `app/(app)/layout.tsx` (redirect to
   `/login` without a session cookie). Making follow-up #1 truly satisfiable
   outside CI needs one of: an e2e-only session fixture/storageState, a
   middleware/layout bypass for intercepted runs, or a headless login against
   the compose stack. **Recommendation for the integrator:** keep the suites
   CI-gated (postgres + redis jobs) and treat the sandbox as
   browser-install-capable but auth-blocked.
