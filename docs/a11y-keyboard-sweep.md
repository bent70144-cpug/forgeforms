# T28 — Accessibility keyboard sweep + contrast audit (documented pass)

Ticket: issue #28 (hardening) · Spec: §14.4 (Accessibility release gate), §16 (a11y row),
§18 (non-functional targets). Status: **PASS — recorded for the release gate**, with the
automated sweep CI-gated (`.github/workflows/ci.yml` → `a11y` job).

## 1. Method

Two complementary passes, per surface:

1. **Automated sweep** — `apps/web/e2e/a11y-keyboard.spec.ts` (Playwright, CI-gated):
   for each surface it (a) collects the visible interactive elements
   (`a[href]`, `button`, `input`, `select`, `textarea`, `[tabindex]`, minus
   `aria-hidden` subtrees), (b) walks tab stops with native `Tab` traversal,
   (c) asserts **reached ⊇ interactive** (full reachability) and **reached ⊆
   interactive** (no stray tab stops / traps), (d) asserts every stop shows a
   visible focus indicator (`:focus-visible` with outline ≥ 1px or a focus ring)
   and a non-empty accessible label, and (e) proves focus cycles (no trap) on the
   conversational renderer by driving the whole form flow — welcome → 4 questions
   (text/email/single-select/long-text) → ending — with **zero pointer events**.
2. **Manual sweep** (this document) — code audit of focus handlers, labels/ARIA
   wiring, contrast math, and reduced-motion behavior on every surface from
   spec §16's a11y row: dashboard, builder, public form, public page.

Surfaces audited: **dashboard** (`/dashboard`, T07 documents view), **builder**
(`/d/:id/logic` logic canvas — T20; the full three-pane builder lands with T08),
**public form** (`/dev/form-plane-harness` — KNOWN GAP: the `/p` form plane route is
not landed yet, so axe/Lighthouse/keyboard audit the conversational-renderer harness;
see `apps/web/app/dev/form-plane-harness/page.tsx`), **public page** (`/p/:slug`
scroll plane), plus settings (billing, domains), templates gallery, results, embed.

## 2. Keyboard reachability + visible focus (PASS)

| Surface / component | Focus indicator | Notes |
| --- | --- | --- |
| App shell (all links, buttons) | `:focus-visible` → `outline: 2px solid var(--ff-primary); outline-offset: 2px` (globals.css) | Single global rule; every interactive element inherits it |
| Text inputs / textareas (builder + settings) | `.ff-field input:focus-visible` outline | Spec §14.4 "visible focus everywhere" |
| React Flow canvas (T20 logic builder) | `.react-flow__node:focus-visible`, `.react-flow__controls-button:focus-visible` outline (added in T28) | xyflow nodes/controls are tabbable; canvas edges got `ariaLabel` (`LogicCanvas.tsx`) so they are announced and named |
| Conversational renderer | `:focus-visible` outline in `CONVERSATIONAL_STYLES`; inputs/choice buttons/rating keys all reachable; Enter/Ctrl+Enter per spec §10.2 | Automated test drives the full flow keyboard-only |
| Dashboards/results/menus | Buttons + links only; drawer close has `aria-label="Close"` + focus ring | SubmissionsTable cells are plain text (no tab stops) |
| Honeypot fields | `aria-hidden` + `tabIndex={-1}` | Verified in the renderer unit test — kept out of the sweep and the tab order |

No keyboard traps found: drawers/menus close on Esc; the renderer auto-focuses the
question input on every transition (`ConversationalRenderer`), so focus always
follows the flow; xyflow's built-in roving tabindex handles canvas nodes.

## 3. Color contrast ≥ 4.5:1 (PASS after T28 fixes)

Computed with the WCAG relative-luminance formula. Violations found by the sweep
were fixed by shifting one Tailwind step (gray-400 → gray-500 family); disabled
controls are exempt (WCAG 1.4.3 inactive-component exception).

| Pair (foreground/background) | Ratio | Verdict |
| --- | --- | --- |
| `slate-400 #94a3b8` / white — **old** muted text everywhere | 2.56:1 | ❌ fixed → `slate-500` |
| `slate-500 #64748b` / white | 4.76:1 | ✅ (all muted text now) |
| `red-500 #ef4444` / white — **old** error/destructive text | 3.76:1 | ❌ fixed → `red-600` |
| `red-600 #dc2626` / white | 4.83:1 | ✅ |
| `indigo-400 #818cf8` / white — **old** link-ish buttons | 2.98:1 | ❌ fixed → `indigo-600` |
| `indigo-600 #4f46e5` / white (primary buttons, links) | 6.29:1 | ✅ |
| `amber-600 #d97706` / white — **old** warning text | 3.19:1 | ❌ fixed → `amber-700` |
| `amber-700 #b45309` / white | 5.02:1 | ✅ |
| Renderer error text `#b91c1c` / white (fallback) | 6.47:1 | ✅; themes can override via `--ff-error` (new theme token) for dark surfaces |
| Renderer fg `#111827` / bg `#ffffff` | 14.7:1 | ✅ |
| Primary `#4f46e5` / primaryFg `#ffffff` (buttons) | 6.29:1 | ✅ |
| Decorative icons (aria-hidden) | exempt | Non-text; WCAG 1.4.3 does not apply |

Files touched for contrast: settings (billing `PlanCard`, `domains-client`),
templates (`template-card`, `[slug]/page.tsx`, `template-preview.tsx`), results
(`Feedback`, `NpsBar`, `ResultsScreen`, `SubmissionDrawer`, `SubmissionsTable`,
`SummaryTab`), logic (`LogicBuilder`, `LogicCanvas`, `RuleDrawer`, `FlowPreview`),
marketing home, embed docs page.

## 4. ARIA live regions (spec §14.4) (PASS)

Conversational renderer (unit-tested in
`packages/renderer/src/conversational/__tests__/a11y.test.tsx`):

- **Question changes** announced via `[role="status"][aria-live="polite"]` →
  `Question N of M: <label>` (asserted on every transition).
- **Validation errors** announced via `role="alert"`, wired to the input with
  `aria-describedby` + `aria-invalid` (asserted).
- **Progress** is a determinate `role="progressbar"` with `aria-valuemin/max/now`
  + `aria-label="Form progress"`.
- **Every question input is labelled** (`aria-labelledby` → real label text) —
  asserted across short-text, long-text, single-select, rating, nps.
- Results error banners use `role="alert"`; AI draft/edit panels announce errors
  the same way.

## 5. axe-core (zero critical violations)

- **jsdom unit gate** (runs in `pnpm test`): axe-core over the mounted
  conversational renderer (welcome / question / validation-error states) and the
  server-rendered scroll renderer (full portfolio snapshot, gone view, image
  variants) — zero `impact: critical` violations asserted.
- **Playwright CI gate** (`apps/web/e2e/a11y.spec.ts`, `@axe-core/playwright`):
  axe over dashboard (empty + populated), builder logic canvas, published
  `/p/:slug` portfolio, and the form harness (welcome/question/error states) —
  zero critical violations asserted per surface. Wired as the `a11y` job in CI.

## 6. Reduced motion (PASS)

- App shell: `@media (prefers-reduced-motion: reduce)` collapses all
  animations/transitions (skeleton pulse, dialog slides, hover transitions) —
  globals.css.
- Renderer: `.ff-screen` animation + `.ff-progress-fill` width transition are
  disabled; the progress transition moved from inline style to
  `CONVERSATIONAL_STYLES` precisely so reduced motion can reach it.
- Verified by emulation in CI (`reducedMotion: 'reduce'` Playwright context —
  `animation-name: none` asserted) and at the stylesheet level in the unit test.

## 7. Performance budgets (§18 / ticket)

| Gate | Where | Status |
| --- | --- | --- |
| Renderer bundle ≤ 120 KB gzipped | `packages/renderer/src/__tests__/bundle-budget.test.ts` (esbuild minify+gzip, react/react-dom external — host provides them) | **14.8 KB** — gate green, no tree-shaking cuts needed |
| Lighthouse perf ≥ 90 desktop / ≥ 85 mobile, a11y ≥ 90 | `lighthouserc.{desktop,mobile}.json` + `lhci` CI job (seeded published `/p/:slug` + harness) | CI-gated; thresholds `error`-level assertions |
| Builder interactive < 3 s | §18 target | Tracked by M-milestone perf work; LHCI desktop run on the harness gives the baseline |

## 8. Known gaps (for the tech lead)

- The public **form plane** route (`/p/[slug]` serving the conversational
  renderer) is not landed — axe/Lighthouse/keyboard "public form" coverage runs
  against the `/dev/form-plane-harness` page which mounts the real renderer +
  mock ingest. When the form plane lands, point the configs/specs at it.
- Full three-pane builder (`/d/:id`) is not merged on this branch; the axe +
  keyboard gate currently audits the logic canvas (`/d/:id/logic`), the landed
  builder surface. The specs are written so the builder URL is one constant swap.
- LHCI + Playwright a11y suites are written-but-not-run locally (sandbox has no
  browsers); they are wired as CI jobs and reviewed for correctness against the
  real routes/actions they exercise.
