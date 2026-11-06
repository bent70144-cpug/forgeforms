# Task 9-b — Builder B0 audit doc, README/spec updates, §13 static perf pass — agent C4 (wave 3b)

Branch: `feat/builder-milestones`. English everywhere. No git commands run.

## Files changed

| File | Change |
| --- | --- |
| `docs/builder-audit.md` | **NEW** — B0 baseline audit per builder-spec §25 template: 40 rows (10 §25 milestone rows incl. the duplicated B1/B2 rows, + 1 E2E(§16) row + 29 section rows for §5.1–§5.4, §6.1–§6.6, §7.1–§7.5, §8.1–§8.5, §9.1–§9.4, §10, §12, §13, §14, §15). Status filled from code evidence only (file paths + what was verified). Includes: scope-notes section (spec.md left untouched — no changelog convention at its end; AGENTS.md untouched), "Performance notes (§13)" budget→assessment→technique table, and 10 follow-ups ordered by data-loss risk. |
| `README.md` (root) | NEW "Builder (document editor)" section (after Features): what it is, route `/d/[docId]`, op-based architecture one-para, B1–B8 milestone table, "Builder tests" (test/typecheck commands + e2e pointer to `apps/web/e2e/README.md`), links to `docs/builder-audit.md` + `docs/a11y-keyboard-sweep.md` + `spec.md` §14 (builder spec referenced as external). Also corrected the Features bullet that falsely claimed "drag-and-drop" (keyboard-first reordering is the truth per audit). |
| `apps/web/components/builder/context.tsx` | PERF EDIT (§13 selector narrowing, additive/safe): added `BuilderDispatchContext` + `useBuilderDispatch()`; `BuilderProvider` now provides both contexts. `useBuilder()` API/behavior unchanged (all 20+ call sites untouched). |
| `apps/web/components/builder/UndoToast.tsx` | PERF EDIT: dispatch-only consumer migrated to `useBuilderDispatch()` — the page-level toast no longer re-renders on every document/selection/save change. |
| `apps/web/components/builder/settings/settings-helpers.ts` | PERF EDIT: `useDebouncedPatch` migrated to `useBuilderDispatch()`. |
| `agent-ctx/9-b-builder-audit-docs-C4.md` | This record. |

`spec.md`: untouched (ends at §21 with no implementation-notes/changelog convention → decision recorded in builder-audit.md §2). `AGENTS.md`: untouched.

## Audit status tally (40 rows)

- **PASS 18** — B1 (both rows), B2 (both rows), B3, §5.1–§5.4, §6.1, §6.3–§6.5, §7.3–§7.5, §8.4, §12(static; axe runtime noted UNTESTED in-row)
- **PARTIAL 19** — B4 (no pointer/touch drag), B5 (23/25 kinds, no Tiptap, no asset picker), B6 (endings schema fields; §23 paper/sunset 3.19:1/3.56:1 flagged + pinned by tests), B7 (10/12 codes — FORM_EMBED_MISSING/MISSING_ASSET missing), B8, §6.2, §6.6 (slug availability), §7.1 (401 modal), §7.2 (stale batch → Discard-only deviation), §8.1, §8.2, §8.3, §8.5 (Logic route separate store), §9.1, §9.2, §9.3, §13, §14, §15 (console stub)
- **FAIL 2** — §9.4 rich text (no Tiptap; `text` = plain string; sanitizer exists unused by builder) and §10 asset picker (builder surface absent; presign/confirm API routes exist, so integration not infra)
- **UNTESTED 1** — E2E suites (§16): written + compile (`playwright test --list` = 10 tests), never executed in this sandbox.

## Known gaps verified against code (all still true)

1. Drag & drop pointer/touch NOT implemented (toolbar handle is a labelled placeholder; keyboard Alt+↑/↓ + toolbar arrows only) — §6.2 PARTIAL. Mobile drag out of scope (§18).
2. Slug availability endpoint missing (`rg slug-check apps/web/app` → no match; TODO comments in `settings-helpers.ts`/`DocSettings.tsx`) — §6.6/§22.1 PARTIAL.
3. Entitlements not resolved client-side (GET envelope carries no permissions; `showBranding` locked-on static gate, `custom_redirect` note-only) — §24 PARTIAL.
4. Telemetry = console stub (`lib/telemetry.ts`, no-op in prod); only `ai_applied`/`template_used` emitted, none of the builder §15 events — §15 PARTIAL.
5. §9.3 shared option-list: schema/helpers + basic add/remove/relabel editor; Enter-add / Backspace-delete / drag reorder / multi-line paste split / duplicate-label warning missing.
6. ARIA move announcements: landing in the parallel wave-3b a11y pass (`lib/builder/announce.tsx` + BuilderShell/Canvas/useShortcuts wiring observed mid-flight; their earlier `announce.ts` (JSX in .ts) briefly broke root lint, self-resolved when renamed to `.tsx`).

## Perf pass (§13) — verified present, no edit needed

- `BlockCard` React.memo ✓ (also `UnknownBlock`); `content-visibility: auto` + `containIntrinsicSize` ✓ (BlockCard style).
- Canvas callbacks stable ✓ (`useCallback` ×8 + memoized `CanvasActions`/`referencedIds`/`themeStyle` + `stateRef` pattern).
- PreviewModal renderer lazy ✓ (`next/dynamic`, `ssr:false`, single import of `@formforge/renderer/conversational`).
- SettingsPanel/ThemePanel lazy: assessed NOT needed — registry editors are lightweight inputs; no Tiptap/React Flow in the builder bundle. Documented in audit.
- Debounced inputs ✓ (300 ms settings/theme/endings; 500 ms autosave). Virtualized left tree + 500-block cap: NOT implemented → follow-ups.
- Selector narrowing: dispatch/state context split implemented (above). Full per-field selectors need the store lifted out of `useReducer` → documented follow-up.

## Verification

- `cd apps/web && pnpm typecheck` — clean.
- `cd apps/web && pnpm test` — green: **76 files / 850 tests passed** (837 at wave start + 13 new a11y tests from the parallel agent; suite green before and after my edits).
- Root `pnpm lint` — exit 0.
- Every file path cited in `docs/builder-audit.md` verified to exist (scripted `[-e]` check over ~70 paths → ALL_PATHS_OK).

## Top 5 follow-ups by data-loss risk (audit §4)

1. Execute e2e suites on a browser-capable runner (never-lose-work paths are integration-tested only).
2. Route stale offline batches into §7.3 conflict instead of Discard-only (`planRecovery` "discard-stale").
3. 401 re-auth handling in the autosave loop (pending ops preserved, but no guided resume).
4. Missing publish codes FORM_EMBED_MISSING + MISSING_ASSET (broken live forms publishable).
5. Slug availability endpoint + "taken" → `-2` suggestion (collision surfaces only at publish today).
