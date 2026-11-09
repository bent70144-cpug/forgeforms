# FormForge UI Redesign — "Meridian" Design System (2026 redesign #2)

You are one of several agents redesigning the FormForge app in parallel. The
orchestrator has ALREADY rewritten the core design tokens (`app/globals.css`
`:root` + night counterpart, and `app/layout.tsx` fonts). Your job is to apply
the new design language to YOUR assigned files only. Read this brief fully
before writing any code.

## The Meridian language (one paragraph)

Light-first editorial: a warm **paper** canvas (`#f7f5f0`), **ink** typography
(`#1a1d26`), **ultramarine** primary (`#3d3bf3`) with a **terracotta** signal
accent (`#c2410c`), crisp 1px rules (`#e5e1d6`), white cards with soft
print-like shadows, 14px radii, generous whitespace. NO glassmorphism, NO
gradient buttons-as-chrome, NO glow-everything, NO neon. It should feel like a
well-set printed document that happens to be interactive: confident type,
quiet surfaces, one strong ultramarine action per view. A tuned dark
"Meridian night" counterpart exists via `prefers-color-scheme: dark` — you do
NOT need to write dark styles; consume tokens and it flips automatically.

## Tokens (already rewritten in `app/globals.css` — consume, never hardcode)

| Token | Light value | Role |
| --- | --- | --- |
| `--ff-bg` / `--ff-bg-2` | `#f7f5f0` / `#efece4` | paper canvas / recessed wells |
| `--ff-card` / `--ff-card-2` | `#ffffff` / `#faf8f4` | cards / card headers-zebra |
| `--ff-fg` / `--ff-muted` | `#1a1d26` / `#686e7e` | ink / secondary text |
| `--ff-border` / `--ff-border-strong` | `#e5e1d6` / `#d1ccbd` | hairlines / emphasized rules |
| `--ff-primary` / `--ff-primary-2` | `#3d3bf3` / `#2b29c7` | ultramarine action / press state |
| `--ff-primary-fg` | `#ffffff` | text on primary |
| `--ff-accent` / `--ff-accent-soft` / `--ff-accent-fg` | `#c2410c` / `#ea580c` / `#ffffff` | terracotta signal |
| `--ff-success/warning/danger` (+`-soft`) | `#15803d` `#a16207` `#dc2626` | semantics |
| `--ff-chart-1/2/3` | `#3d3bf3` `#e2603c` `#0f766e` | charts |
| `--ff-radius` | `0.875rem` | canonical radius |
| `--ff-grad` | ultramarine→deep ultramarine | use sparingly (progress, selected states) |
| `--ff-glow` / `--ff-glow-soft` | restrained ultramarine shadows | primary CTA hover only |
| `--ff-shadow-sm/md/lg` | paper shadows | elevation ladder |
| `--ff-glass` / `--ff-glass-border` | `rgb(255 255 255 / .94)` / `#e5e1d6` | sticky chrome (top bars) |
| `--ff-font-heading` | Sora (`--font-sora`) | display type |
| `--ff-font-body` | Inter (`--font-inter`) | body type |
| `--ff-font-mono` | JetBrains Mono (`--font-jet`) | code/numbers |

## Canonical classes (unchanged — keep using them)

`lib/ui.ts` exports are unchanged: `BTN_PRIMARY`, `BTN_SECONDARY`, `BTN_GHOST`,
`BTN_DESTRUCTIVE`, `CARD` (= `.ff-panel`), `INPUT`, `ICON_BTN`, `BADGE*`,
`BANNER*`, `SEG`/`SEG_BTN`. The CSS recipes behind them in `globals.css`
(BUTTONS, PANELS, FORMS, CHROME, OVERLAYS, STATE sections) are ALREADY
Meridian-styled. Do not re-style `.ff-*` classes; USE them.

## Your working rules

1. **Edit only your assigned files.** Other agents own every other file in
   parallel. If you believe a shared file needs a change, note it in your
   final report instead of editing it.
2. **Preserve functionality.** No prop/API/hook changes, no test-ID or
   `data-testid` removals, no route changes, no logic edits. This is a
   restyle + layout-polish pass.
3. **Keep existing class constants** (`lib/ui.ts`) and Tailwind utilities;
   adjust layout, spacing, typography, and decorative details in JSX + scoped
   styles. When you need a one-off, prefer `color-mix(in srgb, var(--ff-…) …)`
   over new hardcoded hexes.
4. **Typography discipline**: Sora for headings (tight, -0.02em tracking,
   weight 600–700), Inter for body, JetBrains Mono for numeric/telemetry.
   Section titles are smaller than aurora-era: h1 clamp(1.75rem,3vw,2.5rem).
5. **Buttons**: exactly ONE primary ultramarine action per view (hero CTA,
   save/publish); everything else secondary/ghost. Terracotta is for signals,
   badges, highlights, active states — not for large surfaces.
6. **Cards**: white `.ff-panel` on paper bg, 1px `--ff-border`, `--ff-shadow-sm`
   resting / `--ff-shadow-md` hover. No glass blur, no borders that glow.
7. **Accessibility is not negotiable**: keep focus-visible outlines, ≥4.5:1
   text contrast on paper (`--ff-muted` passes; don't go lighter), touch
   targets ≥44px on mobile.
8. **No installs, no builds, no tests.** The orchestrator runs `pnpm install`,
   `typecheck`, `build` and the visual QA pass at the end. Just edit files.
9. Old aurora vocabulary in comments/JSX you touch ("aurora", "glass",
   "violet→cyan") should be updated to Meridian wording where the text is
   user-visible or in code comments of YOUR files.
10. Icons stay stroke-based, 1.5px, currentColor.

## Verified aesthetic targets per surface (follow for your pages)

- Background is paper; recessed areas (table headers, wells, code blocks) use
  `--ff-bg-2`; cards float on `--ff-shadow-sm`.
- Rules (1px borders) do the structural work shadows used to do. Divide
  dashboards with hairlines, not nested boxes.
- Numbers/telemetry: `--ff-font-mono`, tabular-nums.
- Empty states: quiet line icon on `--ff-bg-2` circle, Sora title, one
  secondary action.
