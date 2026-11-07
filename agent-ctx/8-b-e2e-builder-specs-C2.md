# Task 8-b — FormForge builder E2E specs (Playwright) — agent C2 (wave 3a)

Branch: `feat/builder-milestones` · Scope kept: only files under `apps/web/e2e/`
(+ this record). Zero edits to app/components/lib code.

## Files created / changed

| File | Change |
| --- | --- |
| `apps/web/e2e/builder.spec.ts` | NEW — 10 serial describe blocks, 10 tests (see map below) |
| `apps/web/e2e/builder-helpers.ts` | NEW — register/create-modal helpers (documents.spec.ts-style), hermetic `page.route` documents-API mock (logic-builder.spec.ts-style), envelope seeds, `openBuilder`, `saveChip`, `publishButton`, `treeLabels`, console-error recorder, `MOD` chord helper |
| `apps/web/e2e/README.md` | Added "Builder specs (wave 3a, task 8-b)" section: flow map, run command, prerequisites/modes, known integration findings |

## Test map (10 tests, serial)

1. **builder opens** — real dashboard flow (register → create-modal Form → `/d/:id`): shell, top bar (back link, inline title button, Saved chip), three panes, empty canvas/tree, publish gate `Fix 2 issues`; zero console errors (short benign-dev-noise filter).
2. **add blocks via picker** — left-pane "Add block" → palette (search "email" → Enter) inserts Email; canvas "+" insertion row (root index 0) → same picker, search "short" → inserts Short text at index 0; tree order asserted (`["Short text question", "Full name", "Anything else?", "Email address"]`).
3. **edit inline + settings** — card click → `block-settings` right pane; inline label edit commits ("Company email"); `ff-set-required` toggle → chip `Saved` ≤ 3 s; route-mocked PATCH really carried a `block.update` op.
4. **reorder keyboard** — Alt+ArrowDown moves the selected block (tree order flips), Ctrl/Cmd+Z restores.
5. **undo/redo + delete toast** — toolbar `Delete block` → `undo-toast` "Deleted Work email" → Undo button restores within 8 s → Cmd/Ctrl+Shift+Z redoes the delete (toast must NOT reappear).
6. **preview** — "Preview" → `Draft preview` dialog + DRAFT chip → Restart → Esc closes.
7. **publish gate** — empty seed → `data-state="fix-issues"` / "Fix 2 issues" → click opens `issues-drawer` (`NO_QUESTIONS`, `NO_ENDING` chips, "2 blocking issues") → Esc → add Email via empty-canvas suggestion + "Add ending" via left pane → button back to enabled `Publish` (`data-state="publish"`). Publish POST never asserted (client-side gate only).
8. **theme** — Slate Dark preset: asserts `data-preset-id="slate-dark"` aria-pressed + canvas `--ff-bg` computed `rgb(15, 23, 42)`. Self-skips at runtime when no opener control exists (see findings).
9. **keyboard map** — "?" → `Keyboard shortcuts` dialog (Esc closes); Cmd/Ctrl+K → `Add a block` picker dialog.
10. **a11y spot** — axe scan of the full three-pane builder, zero critical violations (a11y.spec.ts gate mirrored).

## Selector inventory (all verified against components via rg)

testids: `builder-shell`, `builder-topbar`, `builder-canvas`, `left-pane`, `settings-panel`, `empty-canvas`, `blocks-tree`, `blocks-tree-empty`, `insertion-row` (+`data-insert-index`/`data-insert-parent`), `block-card-<id>` (+`data-block-kind`), `inline-editable`, `block-settings`, `ff-set-required`, `undo-toast`, `publish-button` (+`data-state`), `issues-drawer`, `issues-count`, `theme-panel`, `preview-modal`, `preview-restart`, `preview-device-desktop`.
roles/labels: dialog `Add a block`, textbox `Search blocks`, option `Email`, button `Add block` / `Insert block here` / `Preview` / `Add ending` / `Add Email` (empty-canvas), `Delete block`, `Undo delete of <label>`, link `Back to dashboard`, region `Form editor`, complementary `Blocks`/`Settings`, tree `Blocks`, dialog `Draft preview`, `Publish issues`, `Keyboard shortcuts`, group `Theme presets`, button `[data-preset-id="slate-dark"]`.
classes (no testid exists): `.ff-save-chip` (scoped inside `builder-topbar`), `.ff-tree-label`, `.ff-doc-card`/`.ff-doc-title` (dashboard, same as documents.spec.ts).

## Selector drift found in the live (mid-integration) tree

1. **InsertionRow quick menu REMOVED in wave 3** — `Quick add block` menu / `Close quick menu` / `menuitem "Short text"` no longer exist; "+" now only emits `ff:open-picker` (BlockPicker is the single insertion surface). Spec rewritten to the picker-only path.
2. **UndoToast double mount (BUG, for wave 3b)** — currently mounted in BOTH `BuilderShell.tsx` (~line 294) AND `BuilderPage.tsx` (~line 393): one delete raises two identical `data-testid="undo-toast"` elements stacked at the same spot. Spec addresses the top-most with `.last()` (clickable) and pins the §6.4 single-toast contract in the hidden-state assertions. **Wave 3b should drop one mount.**
3. **`save-chip` testid does NOT exist on the builder TopBar** (it's the LogicBuilder's testid) — the builder chip is `.ff-save-chip[role="status"]`; spec uses the scoped class.
4. **No control dispatches `setPanel("theme")`** anywhere yet (only "document"/"endings"/"block" call sites exist), so ThemePanel is unreachable through the UI. Theme test probes for a `tab/button "Theme"` opener and `test.skip`s with an explanatory message when absent; all assertions below the skip use real ThemePanel/canvas selectors.

## How validated without browsers

- `pnpm --filter @formforge/web exec tsc --noEmit -p tsconfig.json` — clean (e2e excluded, sanity only).
- Standalone spec typecheck — clean:
  `cd apps/web && pnpm exec tsc --noEmit --skipLibCheck --types node --esModuleInterop --jsx preserve --module esnext --moduleResolution bundler --target es2022 e2e/builder-helpers.ts e2e/builder.spec.ts`
- `pnpm --filter @formforge/web exec eslint e2e/builder.spec.ts e2e/builder-helpers.ts` — clean.
- **`playwright test --list` (compiles the suite, no browser needed): "Total: 10 tests in 1 file"** — strongest sandbox-available validation.
- Every selector cross-checked with rg against the component sources (mismatches listed above; spec corrected where the wave-3 integration had already removed surfaces).
