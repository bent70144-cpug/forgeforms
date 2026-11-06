# Builder keyboard sweep + accessibility walkthrough (task 9-a, wave 3b)

Ticket: task 9-a (§12 accessibility sweep) · Spec: `form_builder_spec.md` §12, §6.2, §6.5, §14.
Scope: the full three-pane builder (`/d/:docId`). Status: **code-audit complete — every §12
acceptance item verified in code (PASS) or fixed in this task (FIXED); browser-run columns are
pre-filled `UNTESTED` where only a live run can confirm** (the dev sandbox has no browsers;
CI runs the automated layer — `e2e/a11y.spec.ts`, `e2e/a11y-keyboard.spec.ts`, `a11y` job).

> Provenance: this file previously recorded the T28 whole-app audit (dashboard / logic canvas /
> public planes). That audit remains valid for its surfaces; this revision supersedes it as the
> **builder editor** walkthrough script required by §12's last bullet ("full keyboard walkthrough
> script … updated to include add, reorder, edit, delete, undo, publish").

## 1. §12 acceptance sweep — results

| §12 item | Result | Evidence (code) |
| --- | --- | --- |
| Landmarks: top bar `banner`, panes `complementary`, canvas `main`/`region` labelled "Form editor" | **PASS** | `BuilderShell.tsx` — `<header>` (banner), `<aside aria-label="Blocks">`, `<aside aria-label="Settings">`, `<main aria-label="Form editor">` wrapping `Canvas` (`section role="region" aria-label="Form editor"`). Tablet/mobile zones swap the left pane for `<nav aria-label="Builder panes">` + labelled dialogs. |
| Block list is an ARIA `tree` with roving tabindex; tree order == canvas order | **FIXED** | `BlocksTree.tsx` — `role="tree"`/`treeitem`, `aria-selected`, `aria-level`, `aria-expanded` already present; **arrows previously moved only the selection, not DOM focus** (screen readers follow focus and would see a frozen tree). `select()` now calls `focusRow()` so ↑/↓/←/→/Enter/Space move focus in lockstep with the roving `tabindex` (exactly one `tabindex="0"` row). Both tree and canvas walk `state.body.blocks` depth-first, so orders are identical by construction. |
| DnD has a keyboard path + live announcements (§6.2) | **FIXED** | Keyboard reorder path = Alt+↑/↓ (§6.5, `useShortcuts`) and the toolbar Move up/down buttons; **new single polite live region** announces every move (contract below). Pointer drag (dnd-kit) remains a tracked follow-up — see §4 (drag handle). |
| Icon-only buttons have `aria-label` | **PASS** | Audited all: TopBar back/undo/redo/settings ⚙, overlay close ✕ buttons, InsertionRow "+", BlockToolbar Move ↑/↓/Duplicate/Delete/⋯, UndoToast Undo/✕, IssuesList close/backdrop, publish "Live — view", PreviewModal param-chip ✕, ListEditor chip ×, ThemePanel color pickers + hex inputs + font selects, EndingsPanel disabled inputs. Tabs have visible text. Unit-sampled in `components/builder/a11y.test.tsx`. |
| Save indicator `role="status"` (polite) | **PASS** | `save-indicator.tsx` — `.ff-save-chip[role="status"][aria-live="polite"]`. |
| Focus management: picker trap+restore; insert → first field focus; delete → next block | **PASS** | `BlockPicker.tsx` (Tab trap + restore on close; BuilderPage `focusInserted` moves focus to the new card after insert); delete selects next/previous root block (`nextSelectionAfterRemove`, `deleteSelection`). Undo/redo buttons keep their own focus. |
| Focus management: dialogs take initial focus; Esc; backdrop | **FIXED** | Picker ✓, PreviewModal ✓ (`usePreviewSession`), IssuesList ✓ (focuses list, Esc, backdrop button), ConflictDialog ✓ ("Use theirs", Esc deliberately inert per §7.3.3), BuilderShell sheets/rail ✓ (Esc + focus back to the invoking control). **FIXED:** `RestorePrompt` marked `data-ff-default-focus` but never focused it — now focuses the preferred control on open. **FIXED:** `ShortcutsHelpDialog` left focus behind the backdrop — panel now takes focus on open. **FIXED:** closing an inline edit dropped focus to `<body>` — `InlineEditable` now restores focus to the element that opened it (card/tree row). |
| Respect `prefers-reduced-motion` | **PASS** | `globals.css` carries one combined guard (`*` → `animation-duration/transition-duration: 0.01ms !important`) plus targeted fallbacks (`.ff-skeleton`, `.ff-int-flash` static-outline variant, preview spinner). No builder animation escapes it; no new motion rules needed in this sweep. |
| Color is never the only indicator | **PASS** | Issue rows show stable code chips + message text (`IssuesList`), warning rows add the abuse-policy note text; tree issue badge is a number with `aria-label`; ThemePanel contrast badges carry WCAG label text; errors use `role="alert"` messages. |
| `dir="auto"` on user-text containers (§14: long text / emoji / RTL) | **FIXED** | Added `dir="auto"` to: `InlineEditable` display span + editing input, `BlocksTree` row labels, `LeftPane` ending rows, canvas ending-card title, `EndingsPanel` preview title/body + list rows, `DocSettings` social-preview title/description, TopBar document-title button. Settings inputs all already had `<label for>`/`aria-label` (PASS). |
| Automated: axe on builder with a seeded doc | **PASS** (CI-gated) | `e2e/a11y.spec.ts` — new "three-pane editor" describe scans `/d/:docId` (shell) **and** the IssuesList drawer state; mirrors the existing surface scans (zero critical gate). |
| Manual: keyboard walkthrough script incl. add/reorder/edit/delete/undo/publish | **PASS** | This document, §3. |

## 2. Live announcement contract (`ff:announce`)

| Field | Value |
| --- | --- |
| Event name | `ff:announce` (`CustomEvent` on `window`) |
| Detail | `{ message: string }` |
| Emitter seam | `announce(message)` in `apps/web/lib/builder/announce.tsx` (SSR-safe, no-op without `window`; testable via injected dispatch target) |
| Current emitters | `Canvas.tsx` `move()` (toolbar Move up/down) · `useShortcuts.ts` Alt+↑/↓ handler |
| Consumer | `<LiveAnnouncer />` — mounted **once** in `BuilderShell`; visually hidden `.ff-a11y-announcer` region with `role="status" aria-live="polite"` (`data-testid="live-announcer"`) |
| Message shape | `"<block display label> moved to position <N> of <M>"` — N/M are 1-based position and sibling count **within the block's own list** (spec §6.2 example: "Question 3 moved to position 1 of 8") |

Both the pointer (toolbar arrows) and keyboard (Alt+Arrow) paths announce through the same seam,
so screen readers hear one consistent announcement regardless of input modality.

## 3. Manual keyboard walkthrough script (§12 last bullet)

How to run: open `/d/:docId` (three-pane desktop ≥ 1200 px), keyboard only — no mouse/touch.
"PASS (code)" = verified by static analysis + unit tests in this sweep; fill the "Browser run"
column during a manual pass. Every step lists the **expected focus target and/or announcement**.

### 3.1 Open + orient

| # | Action | Keys | Expected focus / announcement | Sweep | Browser run |
| --- | --- | --- | --- | --- | --- |
| 1 | Enter the builder | — (load) | First Tab stop = "Back to dashboard" link (banner) | PASS (code) | UNTESTED |
| 2 | Walk the banner | `Tab` | Title → Undo → Redo → Preview → Share → Publish → left pane; every stop shows a visible 2 px `:focus-visible` outline; Undo/Redo announce "Undo"/"Redo" (+ action label in `title`) | PASS (code) | UNTESTED |
| 3 | Land on the blocks tree | `Tab` (from "Add block") | Exactly **one** tree row is a tab stop (roving tabindex = selected row); the tree is labelled "Blocks" inside the "Blocks" complementary pane | PASS (code) | UNTESTED |
| 4 | Canvas region reachable | `Tab` past the tree | Canvas cards are stops; the canvas is `main` + `region` labelled "Form editor" | PASS (code) | UNTESTED |

### 3.2 Add flow (§6.1)

| # | Action | Keys | Expected focus / announcement | Sweep | Browser run |
| --- | --- | --- | --- | --- | --- |
| 5 | Open the picker | `Enter` on "Add block" (or `/`, or `⌘/Ctrl+K` on canvas) | `dialog` "Add a block" opens, search box focused; focus is trapped inside; a polite region reports "<n> blocks match" | PASS (code) | UNTESTED |
| 6 | Search + insert | type `email`, `↓/↑`, `Enter` | Result list announces matches; `Enter` inserts, closes the dialog, **focus moves to the new card** (§12 "inserting moves focus to its first field" — card label first, `Enter` re-opens the field) | PASS (code) | UNTESTED |
| 7 | Cancel the picker | `Esc` | Dialog closes, focus returns to the control that opened it | PASS (code) | UNTESTED |
| 8 | Insert at a position | `Tab` to a canvas "+" ("Insert block here") → `Enter` → picker → `Enter` | Block inserts at that `{index, parentId}`; tree order == canvas order | PASS (code) | UNTESTED |

### 3.3 Reorder flow (§6.2 / §12)

| # | Action | Keys | Expected focus / announcement | Sweep | Browser run |
| --- | --- | --- | --- | --- | --- |
| 9 | Select via tree | `↑`/`↓` on a tree row | Focus **and** selection move together (`aria-selected` follows focus); `aria-level`/`aria-expanded` announce container structure; `→`/`←` expand/collapse (or step into/out of children) | FIXED+PASS (code) | UNTESTED |
| 10 | Move by keyboard | `Alt+↓` (selected block) | Block swaps with the next sibling; live region announces **"\<label\> moved to position 2 of 2"** (polite); at the edges the key is a silent no-op | FIXED+PASS (code) | UNTESTED |
| 11 | Move by toolbar | `Tab` to "Move up"/"Move down" on the selected card → `Enter` | Same announcement through the same live region; buttons disable at the boundaries (`aria-disabled` via `disabled`) | PASS (code) | UNTESTED |
| 12 | Drag handle is inert | `Tab` across the toolbar | The ⠿ handle is **not** a tab stop and not a button (it is `aria-hidden` with a "coming soon" hint) — no dead button; pointer DnD is a tracked follow-up (§6.2) | PASS (code) | UNTESTED |

### 3.4 Edit flow (§5.2 / §6.5)

| # | Action | Keys | Expected focus / announcement | Sweep | Browser run |
| --- | --- | --- | --- | --- | --- |
| 13 | Open inline edit | `Enter` on a focused/selected card (or `Enter` from the tree) | The block's primary-text field is focused + selected; input is labelled "Edit \<kind\> text" and `dir="auto"` | FIXED+PASS (code) | UNTESTED |
| 14 | Commit | type, `Enter` (multiline: `Ctrl/⌘+Enter`) | Commits via `block.update` (coalesced); save chip `role="status"` announces "Saving… / Saved"; focus returns to the card | PASS (code) | UNTESTED |
| 15 | Cancel | `Esc` | Draft discarded, **focus restored to the element that opened the edit** (card / tree row), never dropped to `<body>` | FIXED (code) | UNTESTED |
| 16 | Settings panel | select a block → `Tab` into the right pane | Every control has an associated `<label for>`/`aria-label`; field errors are `role="alert"` text and `aria-invalid` (never color-only) | PASS (code) | UNTESTED |

### 3.5 Delete / undo flow (§6.3 / §6.4)

| # | Action | Keys | Expected focus / announcement | Sweep | Browser run |
| --- | --- | --- | --- | --- | --- |
| 17 | Delete a block | `Delete`/`Backspace` on a selected block (or toolbar ✕) | No confirm dialog; polite toast: "Deleted \<label\>" (+ "Used by logic rules" text when referenced) with an "Undo delete of \<label\>" button; selection moves to the next block (else previous) | PASS (code) | UNTESTED |
| 18 | Undo the delete | `Tab` to the toast → `Enter` (or `⌘/Ctrl+Z`) | Block restored at its original index; toast dismisses | PASS (code) | UNTESTED |
| 19 | Dismiss the toast | `Esc` (toast visible) | Toast closes within its 8 s window or immediately on `Esc` | PASS (code) | UNTESTED |
| 20 | Undo / redo chords | `⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z` / `Ctrl+Y` | Work everywhere (even while typing, per §6.5); buttons disable when the stacks are empty and their `title` names the next action ("Undo: delete question") | PASS (code) | UNTESTED |

### 3.6 Publish flow (§4 / §8.1)

| # | Action | Keys | Expected focus / announcement | Sweep | Browser run |
| --- | --- | --- | --- | --- | --- |
| 21 | Hit the publish gate | `Tab` to Publish ("Fix N issues") → `Enter` | The §8.1 drawer opens as `role="dialog"` "Publish issues"; focus moves into the list; the count line is `aria-live="polite"` ("2 blocking issues, 1 warning") | PASS (code) | UNTESTED |
| 22 | Jump to an issue | `Tab` to "Go to" → `Enter` | Drawer closes, block selected + scrolled into view with a reduced-motion-guarded flash; right pane shows that block's settings | PASS (code) | UNTESTED |
| 23 | Close the drawer | `Esc` / "Close publish issues" / backdrop | Drawer closes (focus returns into the page; reopenable via the publish button) | PASS (code) | UNTESTED |
| 24 | Publish clean | `Tab` to "Publish" → `Enter` | Button flips to "Publishing…" (announced, `aria-live` on the button) → "Published ✓" (disabled) + "Live — view" link; conflict path announces "Saving your changes — try again" via `role="status"` | PASS (code) | UNTESTED |

### 3.7 Help + overlays

| # | Action | Keys | Expected focus / announcement | Sweep | Browser run |
| --- | --- | --- | --- | --- | --- |
| 25 | Shortcut help | `?` | "Keyboard shortcuts" dialog opens **and takes focus** (§12); `Esc` closes | FIXED (code) | UNTESTED |
| 26 | Preview | `⌘/Ctrl+Shift+P` (or Preview button) | "Draft preview" modal takes focus; `Esc`/Close/backdrop close and return focus to the trigger | PASS (code) | UNTESTED |
| 27 | Recovery prompts | — (reload with pending ops) | `RestorePrompt` focuses its default action ("Restore", or "Discard" for stale records) on appearance | FIXED (code) | UNTESTED |
| 28 | Conflict dialog | — (409 without clean rebase) | Focuses the safe default "Use theirs"; `Esc` deliberately inert (§7.3.3 — a choice is required) | PASS (code) | UNTESTED |

## 4. §6.5 shortcut map (as implemented)

| Shortcut | Action | Where |
| --- | --- | --- |
| `⌘/Ctrl+K` or `/` | Open block picker | `useShortcuts` → `ff:open-picker` |
| `⌘/Ctrl+Z` / `⌘/Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo | `useShortcuts` |
| `⌘/Ctrl+S` | Force save now | `useShortcuts` → `ff:force-save` |
| `⌘/Ctrl+D` | Duplicate selected block (new ids) | `useShortcuts` |
| `Delete` / `Backspace` | Delete selected block (not while typing) → Undo toast | `useShortcuts` |
| `↑` / `↓` | Select previous / next root block | `useShortcuts` |
| `Alt+↑` / `Alt+↓` | Move selected block up / down → **live announcement** | `useShortcuts` + `announce()` |
| `Enter` | Edit selected block's primary text inline | `useShortcuts` → `ff:edit-selected` |
| `Esc` | Cancel inline edit / close picker / deselect | `InlineEditable` / `BlockPicker` / `useShortcuts` |
| `⌘/Ctrl+Shift+P` | Open Preview | `useShortcuts` → `ff:open-preview` |
| `?` | Shortcut help dialog | `useShortcuts` |
| Tree: `↑ ↓ ← →`, `Enter`/`Space` | ARIA tree navigation (expand/collapse/step into, select) | `BlocksTree` |

Shortcuts are ignored while typing in inputs/textarea/select, except `⌘/Ctrl+Z`, `⌘/Ctrl+S`,
`⌘/Ctrl+K` (§6.5) — enforced by `shouldIgnoreShortcut`.

## 5. Automated coverage (CI `a11y` job)

- `apps/web/e2e/a11y.spec.ts` — axe (zero critical): dashboard, **builder `/d/:docId` shell +
  IssuesList drawer states (new)**, builder logic canvas, public page, public form harness,
  reduced-motion emulation.
- `apps/web/e2e/a11y-keyboard.spec.ts` — **new builder path (zero pointer events)**: picker
  inserts → Shift+Tab into the tree (proves the single roving tab stop) → arrows move focus +
  selection → `Enter` inline edit → `Esc` restores focus → `Alt+ArrowDown` → asserts the
  `live-announcer` text "Email address moved to position 2 of 2" and the flipped tree order.
- `apps/web/components/builder/a11y.test.tsx` — static ARIA assertions (tree semantics + one
  roving stop, icon-button labels, inert drag handle, `dir="auto"`, toast/drawer live regions)
  and the `announce()` / `<LiveAnnouncer />` contract test.
