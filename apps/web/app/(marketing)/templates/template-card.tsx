// Gallery card for a template summary. The thumbnail is a designed, honest
// placeholder drawn in pure CSS (no images, no dynamically-scanned Tailwind
// gradient classes — the core data package isn't scanned, which is what made
// the old gradient render as an empty box). Motif varies by category:
// form → question-card stack, page → mini scroll-page, portfolio → tile grid.
import Link from "next/link";

import type { TemplateCategory, TemplateSummary } from "@formforge/core/templates";

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
    <Link
      href={`/templates/${template.id}`}
      className="group flex flex-col overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-lg"
    >
      <div
        aria-hidden
        className="relative flex aspect-[16/10] items-center justify-center overflow-hidden border-b border-[var(--ff-border)]"
        style={{ background: tintBackground(template.accent) }}
      >
        <ThumbnailMotif category={template.category} accent={template.accent} />
        <span className="absolute bottom-3 left-3 rounded-full border border-[var(--ff-border)] bg-[var(--ff-card)] px-3 py-1 text-xs font-medium text-[var(--ff-fg)]">
          {CATEGORY_LABEL[template.category] ?? template.category}
        </span>
        {template.hasLogic && (
          <span className="absolute right-3 top-3 rounded-full bg-[var(--ff-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--ff-primary-fg)]">
            + Logic
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <h2 className="text-base font-semibold leading-snug text-[var(--ff-fg)] transition-colors group-hover:text-[var(--ff-primary)]">
          {template.name}
        </h2>
        <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-[var(--ff-muted)]">{template.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-[var(--ff-muted)]">
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
  );
}
