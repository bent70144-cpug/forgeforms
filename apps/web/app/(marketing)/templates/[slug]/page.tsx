// Template preview page: /templates/[slug] (spec §14.1.9, issue #22).
// Server component — no client JS; data comes from @formforge/core/templates.
//
// "Meridian" layout: a document-like page — a max-w prose column on paper,
// sections separated by 1px hairlines instead of nested boxes. The title
// block opens the document, the self-themed preview sits in a white framed
// panel (1px border, --ff-shadow-md), and a closing details section carries
// the ONE ultramarine primary CTA plus a hairline spec list with mono labels.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getTemplate, listTemplates } from "@formforge/core/templates";
import type { Block, TemplateCategory } from "@formforge/core/templates";

import { Icon, type IconName } from "@/components/ui/icons";
import { BADGE_ACCENT, BADGE_MUTED, BADGE_POSITIVE, BTN_GHOST_SM, BTN_PRIMARY_LG, CARD } from "@/lib/ui";

import TemplatePreview from "./template-preview";

const CATEGORY_LABEL: Record<string, string> = {
  form: "Form",
  page: "Landing page",
  portfolio: "Portfolio",
};

const CATEGORY_ICON: Record<TemplateCategory, IconName> = {
  form: "list",
  page: "globe",
  portfolio: "grid",
};

// Spec row for the hairline <dl>: mono uppercase label column, value fills
// the rest. tabular keeps numeric columns steady.
function SpecRow({ term, value, tabular = false }: { term: string; value: string; tabular?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline border-b border-[var(--ff-border)] py-3 last:border-b-0">
      <dt className="text-[0.75rem] uppercase tracking-[0.08em] text-[var(--ff-muted)] [font-family:var(--ff-font-mono)]">
        {term}
      </dt>
      <dd className={`m-0 text-sm font-medium text-[var(--ff-fg)]${tabular ? " tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

export function generateStaticParams(): { slug: string }[] {
  return listTemplates().map((t) => ({ slug: t.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const template = getTemplate(slug);
  if (!template) return { title: "Template not found — FormForge" };
  return {
    title: `${template.meta.name} template — FormForge`,
    description: template.meta.description,
  };
}

export default async function TemplatePreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const template = getTemplate(slug);
  if (!template) notFound();

  const { meta, body } = template;
  let blockCount = 0;
  let questionCount = 0;
  const kinds = new Set<string>();
  walkBlocks(body.blocks, (b) => {
    blockCount += 1;
    if (QUESTION_KINDS.has(b.kind)) questionCount += 1;
    kinds.add(b.kind);
  });
  const logicCount = body.logic.rules.length;

  return (
    <main className="mx-auto w-full max-w-3xl px-[clamp(1rem,3vw,1.5rem)] py-12 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-8">
        <Link href="/templates" className={`${BTN_GHOST_SM} -ml-2`}>
          <Icon name="arrowLeft" size={14} />
          All templates
        </Link>
      </nav>

      {/* Title block: quiet category tile, badge row, Sora headline. */}
      <header>
        <span
          aria-hidden="true"
          className="grid h-11 w-11 place-items-center rounded-[12px] border border-[var(--ff-border)] bg-[var(--ff-bg-2)] text-[var(--ff-fg)]"
        >
          <Icon name={CATEGORY_ICON[meta.category]} size={20} />
        </span>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={BADGE_ACCENT}>{CATEGORY_LABEL[meta.category] ?? meta.category}</span>
          {meta.tags.map((tag) => (
            <span key={tag} className={BADGE_MUTED}>
              {tag}
            </span>
          ))}
          <span className={BADGE_MUTED}>
            {blockCount} block{blockCount === 1 ? "" : "s"}
          </span>
          {logicCount > 0 && (
            <span className={BADGE_POSITIVE}>
              {logicCount} logic rule{logicCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <h1 className="mt-4 text-balance text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.12] tracking-[-0.02em] text-[var(--ff-fg)] [font-family:var(--ff-font-heading)]">
          {meta.name}
        </h1>
        <p className="mt-3 max-w-[56ch] text-lg leading-relaxed text-[var(--ff-muted)]">{meta.description}</p>
      </header>

      <section aria-label="Template preview" className="mt-10 border-t border-[var(--ff-border)] pt-8">
        <h2 className="m-0 text-xl font-semibold tracking-[-0.01em] text-[var(--ff-fg)] [font-family:var(--ff-font-heading)]">
          Preview
        </h2>
        {/* The white framed panel provides the print-like plate (1px hairline
            + --ff-shadow-md); the preview supplies its own muted desk frame
            and self-themed miniature page inside it. */}
        <div className={`${CARD} mt-4 overflow-hidden shadow-[var(--ff-shadow-md)]!`}>
          <TemplatePreview body={body} />
        </div>
      </section>

      <section aria-label="Use this template" className="mt-10 border-t border-[var(--ff-border)] pt-8">
        <h2 className="m-0 text-xl font-semibold tracking-[-0.01em] text-[var(--ff-fg)] [font-family:var(--ff-font-heading)]">
          Use this template
        </h2>
        {/* What "Use this template" does — no price/plan is stated because
            instantiation is part of every workspace's create flow. */}
        <p className="mt-2 max-w-[56ch] text-[0.9375rem] leading-relaxed text-[var(--ff-muted)]">
          Copies into your workspace as an editable draft.
        </p>
        {/* "Use template" — the authenticated create flow (spec §14.1.2) picks up ?template= */}
        <Link href={`/dashboard?template=${meta.id}`} className={`${BTN_PRIMARY_LG} mt-5`}>
          Use this template
        </Link>

        <dl className="m-0 mt-8 border-t border-[var(--ff-border)]">
          <SpecRow term="Blocks" value={String(blockCount)} tabular />
          {meta.category === "form" && <SpecRow term="Questions" value={String(questionCount)} tabular />}
          <SpecRow term="Logic" value={logicCount > 0 ? `${logicCount} rules` : "none"} tabular />
          <SpecRow term="Fonts" value={`${body.theme.fontHeading} / ${body.theme.fontBody}`} />
        </dl>

        <div className="border-t border-[var(--ff-border)] pt-6">
          <h3 className="m-0 text-[0.8125rem] font-semibold text-[var(--ff-fg)]">What&apos;s inside</h3>
          <ul className="mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
            {Array.from(kinds).map((kind) => (
              <li
                key={kind}
                className="rounded-md border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-2 py-1 text-xs text-[var(--ff-muted)] [font-family:var(--ff-font-mono)]"
              >
                {kind}
              </li>
            ))}
          </ul>
          {meta.category === "form" && body.endings.length > 0 && (
            <p className="mb-0 mt-3 text-sm leading-relaxed text-[var(--ff-muted)]">
              Ends on {body.endings.length} screen{body.endings.length === 1 ? "" : "s"}:{" "}
              {body.endings.map((e) => `“${e.title}”`).join(", ")}.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function walkBlocks(blocks: readonly Block[], visit: (b: Block) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.children) walkBlocks(b.children, visit);
  }
}

const QUESTION_KINDS = new Set([
  "short-text",
  "long-text",
  "email",
  "number",
  "single-select",
  "multi-select",
  "dropdown",
  "rating",
  "nps",
  "file-upload",
]);
