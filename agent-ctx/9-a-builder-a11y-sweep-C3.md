# Task 9-a — FormForge builder accessibility sweep (§12) + keyboard walkthrough — agent C3 (wave 3b)

Branch: `feat/builder-milestones` · Scope: `apps/web/components/builder/**` (a11y-only),
`apps/web/lib/builder/announce.tsx` (new), `apps/web/app/globals.css` (`ff-a11y-` classes only),
`apps/web/e2e/a11y*.spec.ts` (extensions), `docs/a11y-keyboard-sweep.md` (rewrite),
this record. No new deps. No git commands run.

## Files changed (edit → §12 item it fixes)

| File | Change | §12 item |
| --- | --- | --- |
| `apps/web/lib/builder/announce.tsx` | NEW — `announce(msg, target?)` dispatching window `CustomEvent("ff:announce", {detail:{message}})` (SSR-safe, injectable target for tests), `useLiveAnnouncer()` hook, `<LiveAnnouncer />` component (role=status aria-live=polite, `data-testid="live-announcer"`, keyed span so text-node replacement re-announces) | DnD keyboard announcements (§6.2) |
| `components/builder/BuilderShell.tsx` | Mounts `<LiveAnnouncer />` once at the shell root | §6.2/§12 live region |
| `components/builder/Canvas.tsx` | `move()` announces `"<label> moved to position N of M"` after a successful `block.move` (toolbar Move up/down path) + `dir="auto"` on ending-card title | §6.2 announcements; §14 dir=auto |
| `components/builder/useShortcuts.ts` | Alt+↑/↓ handler announces the same message (keyboard reorder path); `ShortcutsHelpDialog` now focuses the dialog panel on open (`tabIndex={-1}` + effect) | §6.2 announcements; §12 dialog focus |
| `components/builder/BlocksTree.tsx` | **Roving tabindex actually implemented**: arrows previously changed only the store selection — DOM focus stayed on the old row (SRs would see a frozen tree). `select()` now focuses the row (`treeRef` + `[data-block-id]` query) in lockstep; `dir="auto"` on row labels | §12 ARIA tree roving tabindex; §14 |
| `components/builder/InlineEditable.tsx` | Focus-restore: captures the opening element before auto-focusing the input, restores it on commit/cancel (only if focus fell to `<body>`); `dir="auto"` on display span + editing input | §12 focus management; §14 |
| `components/builder/RestorePrompt.tsx` | Dialog now focuses `[data-ff-default-focus]` (else first button) on open — the attribute existed but nothing ever focused it | §12 focus management |
| `components/builder/TopBar.tsx` | `dir="auto"` on the document-title button | §14 |
| `components/builder/LeftPane.tsx` | `dir="auto"` on ending row labels | §14 |
| `components/builder/EndingsPanel.tsx` | `dir="auto"` on ending list rows + preview title/body | §14 |
| `components/builder/settings/DocSettings.tsx` | `dir="auto"` on social-preview title/description | §14 |
| `apps/web/app/globals.css` | APPEND ONLY: `.ff-a11y-announcer` (visually-hidden live region) + comment. No new motion rules — the existing global `prefers-reduced-motion` collapse + `.ff-int-flash` fallback already cover every builder animation | §12 reduced motion (verified) |
| `apps/web/e2e/a11y.spec.ts` | NEW describe: axe scan of `/d/:docId` shell **and** the IssuesList drawer state (empty-form publish gate); imports `publishButton` from builder-helpers | §12 automated axe on builder |
| `apps/web/e2e/a11y-keyboard.spec.ts` | NEW builder path (zero pointer events): picker inserts (email, short) → Shift+Tab walk into the tree → exactly-one roving stop assert → arrows move focus+selection → Enter opens inline edit ("Edit Email text") → Esc restores focus to the block → Alt+ArrowDown → asserts `live-announcer` text "Email address moved to position 2 of 2" + flipped tree order | §12 manual path, automated |
| `apps/web/components/builder/a11y.test.tsx` | NEW (13 tests, jsdom pragma): tree semantics (aria-selected/level/expanded, ONE tabindex=0), toolbar aria-labels + inert drag handle (never a `<button>`), InsertionRow/IssuesList labels + polite count line, UndoToast status region + labelled actions, dir=auto (inline editable, tree labels, SEO preview), LiveAnnouncer static markup, `announce()` contract (injected target, empty-message no-op, null-target SSR safety), mounted announcer live test | §12 unit coverage |
| `docs/a11y-keyboard-sweep.md` | REWRITTEN as the builder walkthrough script: §12 results table (PASS/FIXED/UNTESTED), `ff:announce` contract, 28-step walkthrough (open/add/reorder/edit/delete/undo/publish/help) with action→keys→expected→sweep→browser-run columns, §6.5 shortcut map, CI coverage list. Notes it supersedes the T28 whole-app revision for the builder editor surface | §12 last bullet |

## Sweep highlights (full table in docs/a11y-keyboard-sweep.md)

- **Already PASS (verified, untouched):** landmarks (header/aside×2/main+region "Form editor"),
  all icon-button labels, save chip `role="status"`, UndoToast + IssuesList live regions,
  picker/preview/issues/conflict/sheet focus management, color-never-sole-indicator,
  reduced-motion (global collapse guard), settings form labels.
- **FIXED:** tree roving focus, move announcements (new contract below), RestorePrompt initial
  focus, ShortcutsHelpDialog initial focus, inline-edit focus restore, `dir="auto"` on 8
  user-text surfaces.
- **Drag handle (inert milestone):** it is an `aria-hidden` span, NOT a button — correct inert
  treatment; keyboard reorder = Alt+arrows; documented in the sweep doc (§3.3 row 12).
- Out-of-scope finding resolved en route: the C2-era UndoToast double mount is gone in this
  tree — `BuilderPage.tsx` renders the single `<UndoToast />` (grep-verified; BuilderShell no
  longer mounts one), so §6.4's one-toast contract holds.

## Live announcer event contract

`window` `CustomEvent` **`ff:announce`**, `detail: { message: string }`.
Emitters: `Canvas.move()` + `useShortcuts` Alt+Arrow. Consumer: `<LiveAnnouncer />` (single
polite region, `data-testid="live-announcer"`, class `ff-a11y-announcer`).
Message: `"<display label> moved to position <N> of <M>"` (1-based, within the block's own list).

## Verification (all green)

- `pnpm typecheck` (apps/web) — clean.
- `pnpm test` (apps/web) — **850/850 passed** (was 837; +13 from `a11y.test.tsx`).
- `pnpm lint` (monorepo) — zero errors.
- Standalone e2e compile — clean: `pnpm exec tsc --noEmit --skipLibCheck --types node
  --esModuleInterop --jsx preserve --module esnext --moduleResolution bundler --target es2022
  e2e/a11y.spec.ts e2e/a11y-keyboard.spec.ts`.
- `playwright test --list` on the two a11y specs compiles: **10 tests in 2 files**.

## Untested / handoff notes

- Browser-run columns in the walkthrough doc are `UNTESTED` (sandbox has no browsers); CI runs
  the axe + keyboard specs against the compose stack.
- Pointer DnD (dnd-kit) remains a later milestone; the keyboard path + announcements are the
  §6.2-compliant path shipped here. When DnD lands, reuse `announce()` for drop announcements.
- `BlockPicker` group headers are `aria-hidden` (family names not announced) — acceptable for
  the palette pattern (options carry full `aria-label`); revisit if SR feedback asks for it.
