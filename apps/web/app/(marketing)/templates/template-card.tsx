// Gallery card for a template summary. The thumbnail is a designed, honest
// placeholder drawn in pure CSS (no images, no dynamically-scanned Tailwind
// gradient classes — the core data package isn't scanned, which is what made
// the old gradient render as an empty box). Motif varies by category:
// form → question-card stack, page → mini scroll-page, portfolio → tile grid.
//
// The card root is a SpotlightCard (pointer-tracked highlight — mouse-only,
// reduced-motion safe, nothing depends on it running). The <Link> fills the
// whole card so the entire surface is clickable. Hover motion is
// transform/opacity/box-shadow only. NOTE: the .ff-spot recipe in globals.css
// is unlayered CSS, so utility overrides on it need Tailwind's `!` suffix.
import Link from "next/link";

import type { TemplateCategory, TemplateSummary } from "@formforge/core/templates";

import SpotlightCard from "@/components/landing/spotlight-card";
import { Icon } from "@/components/ui/icons";
import { BADGE_ACCENT, BADGE_MUTED } from "@/lib/ui";

const CATEGORY_LABEL: Record<string, string> = {
  form: "Form",
  page: "Landing page",
  portfolio: "Portfolio",
};

/** Subtle two-stop tint built from the template accent over the page token —
 *  flips correctly in dark mode because both stops resolve at paint time. */
function tintBackground(accent: string): string {
  return `linear-gradient(135deg, color-mix(in srgb, ${accent} 16%, var(--ff-bg)), color-mix(in srgb, ${accent} 6%, var(--ff-bg)))`;
}

function FormMotif() {
  return (
    <div className="relative" aria-hidden>
      {/* card behind, offset — the "stack" */}
      <div className="absolute inset-0 translate-x-3.5 translate-y-2.5 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] opacity-60" />
      <div className="relative w-44 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4 shadow-sm">
        <div className="space-y-2">
          <div className="h-1.5 w-4/5 rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_30%,transparent)]" />
          <div className="h-1.5 w-3/5 rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_30%,transparent)]" />
          <div className="h-1.5 w-2/3 rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_30%,transparent)]" />
        </div>
        <div className="mt-3 flex h-7 w-28 items-center rounded-full border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3">
          <div className="h-1.5 w-12 rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_20%,transparent)]" />
        </div>
      </div>
    </div>
  );
}

function PageMotif({ accent }: { accent: string }) {
  return (
    <div className="w-40 overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] shadow-sm" aria-hidden>
      <div
        className="m-2.5 h-16 rounded-[calc(var(--ff-radius)*0.66)]"
        style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 55%, var(--ff-fg)))` }}
      />
      <div className="space-y-2 px-3 pb-4">
        <div className="h-1.5 w-full rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_30%,transparent)]" />
        <div className="h-1.5 w-2/3 rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_30%,transparent)]" />
      </div>
    </div>
  );
}

function PortfolioMotif({ accent }: { accent: string }) {
  return (
    <div className="grid w-40 grid-cols-2 gap-2.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="aspect-square rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)]"
          style={{
            background:
              i % 3 === 0
                ? `linear-gradient(135deg, color-mix(in srgb, ${accent} 55%, transparent), color-mix(in srgb, ${accent} 25%, transparent))`
                : "var(--ff-card)",
          }}
        />
      ))}
    </div>
  );
}

function ThumbnailMotif({ category, accent }: { category: TemplateCategory; accent: string }) {
  if (category === "page") return <PageMotif accent={accent} />;
  if (category === "portfolio") return <PortfolioMotif accent={accent} />;
  return <FormMotif />;
}

export default function TemplateCard({ template }: { template: TemplateSummary }) {
  return (
    <SpotlightCard className="group h-full rounded-[16px]! p-0! shadow-sm transition-[translate,box-shadow,border-color] duration-[220ms] ease-out hover:-translate-y-[3px] hover:border-[color:color-mix(in_srgb,var(--ff-accent)_35%,var(--ff-border))]! hover:shadow-md">
      <Link
        href={`/templates/${template.id}`}
        className="flex h-full flex-col overflow-hidden rounded-[inherit]"
      >
        <div
          aria-hidden
          className="relative flex aspect-[16/10] items-center justify-center overflow-hidden border-b border-[var(--ff-border)]"
          style={{ background: tintBackground(template.accent) }}
        >
          <ThumbnailMotif category={template.category} accent={template.accent} />
        </div>

        <div className="flex flex-1 flex-col p-5">
          <h2 className="flex items-start gap-1.5 text-[15px] font-semibold leading-snug text-[var(--ff-fg)] transition-colors duration-200 group-hover:text-[var(--ff-accent)]">
            <span className="min-w-0">{template.name}</span>
            <Icon
              name="arrowRight"
              size={16}
              className="mt-0.5 shrink-0 translate-x-0 opacity-0 transition-[opacity,translate] duration-200 ease-out group-hover:translate-x-0.5 group-hover:opacity-100"
            />
          </h2>
          <p className="mt-1.5 line-clamp-2 flex-1 text-sm leading-relaxed text-[var(--ff-muted)]">
            {template.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className={BADGE_MUTED}>{CATEGORY_LABEL[template.category] ?? template.category}</span>
            {template.hasLogic && <span className={BADGE_ACCENT}>+ Logic</span>}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-[var(--ff-muted)]">
            <span>{template.blockCount} blocks</span>
            {template.questionCount > 0 && <span>· {template.questionCount} questions</span>}
            {template.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="rounded-full border border-[var(--ff-border)] px-2 py-0.5 font-medium">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </SpotlightCard>
  );
}
