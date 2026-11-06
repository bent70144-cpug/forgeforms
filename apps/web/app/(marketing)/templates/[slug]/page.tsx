// Template preview page: /templates/[slug] (spec §14.1.9, issue #22).
// Server component — no client JS; data comes from @formforge/core/templates.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getTemplate, listTemplates } from "@formforge/core/templates";
import type { Block } from "@formforge/core/templates";

import { Icon } from "@/components/ui/icons";
import { BADGE_ACCENT, BADGE_MUTED, BADGE_POSITIVE, BTN_GHOST_SM, BTN_PRIMARY_LG, CARD } from "@/lib/ui";

import TemplatePreview from "./template-preview";

const CATEGORY_LABEL: Record<string, string> = {
  form: "Form",
  page: "Landing page",
  portfolio: "Portfolio",
};

// Spec row for the hairline <dl>: fixed label column, value fills the rest.
function SpecRow({ term, value, tabular = false }: { term: string; value: string; tabular?: boolean }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-baseline border-t border-[var(--ff-border)] py-3">
      <dt className="text-sm text-[var(--ff-muted)]">{term}</dt>
      <dd className={`text-sm font-medium text-[var(--ff-fg)]${tabular ? " tabular-nums" : ""}`}>{value}</dd>
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
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link href="/templates" className={`${BTN_GHOST_SM} -ml-2`}>
          <Icon name="arrowLeft" size={14} />
          All templates
        </Link>
      </nav>

      {/* One grid spans the whole page so the CTA panel can stay sticky all
          the way down the preview; on mobile the source order reads
          info → CTA → preview. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <header className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">
            {meta.name}
          </h1>
          <p className="mt-3 max-w-[56ch] text-lg leading-relaxed text-[var(--ff-muted)]">{meta.description}</p>

          <dl className="mt-8 border-b border-[var(--ff-border)]">
            <SpecRow term="Blocks" value={String(blockCount)} tabular />
            {meta.category === "form" && <SpecRow term="Questions" value={String(questionCount)} tabular />}
            <SpecRow term="Logic" value={logicCount > 0 ? `${logicCount} rules` : "none"} tabular />
            <SpecRow term="Fonts" value={`${body.theme.fontHeading} / ${body.theme.fontBody}`} />
          </dl>
        </header>

        <aside
          aria-label="Use this template"
          className={`${CARD} flex flex-col gap-4 self-start p-6 shadow-md! lg:sticky lg:top-24 lg:row-span-2`}
        >
          {/* What "Use this template" does — no price/plan is stated because
              instantiation is part of every workspace's create flow. */}
          <p className="m-0 text-sm leading-relaxed text-[var(--ff-muted)]">
            Copies into your workspace as an editable draft.
          </p>
          {/* "Use template" — the authenticated create flow (spec §14.1.2) picks up ?template= */}
          <Link href={`/dashboard?template=${meta.id}`} className={`${BTN_PRIMARY_LG} w-full`}>
            Use this template
          </Link>
          <div className="border-t border-[var(--ff-border)] pt-4">
            <h2 className="m-0 text-[0.8125rem] font-semibold text-[var(--ff-fg)]">What&apos;s inside</h2>
            <ul className="mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
              {Array.from(kinds).map((kind) => (
                <li
                  key={kind}
                  className="rounded-md border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_5%,transparent)] px-2 py-1 font-mono text-xs text-[var(--ff-muted)]"
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
        </aside>

        <section aria-label="Template preview" className="mt-2 min-w-0 lg:col-start-1 lg:row-start-2">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--ff-fg)]">Preview</h2>
          {/* The panel provides border + shadow; the preview supplies its own
              muted frame and self-themed miniature page inside it. */}
          <div className={`${CARD} mt-4 overflow-hidden`}>
            <TemplatePreview body={body} />
          </div>
        </section>
      </div>
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
