// Template preview page: /templates/[slug] (spec §14.1.9, issue #22).
// Server component — no client JS; data comes from @formforge/core/templates.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getTemplate, listTemplates } from "@formforge/core/templates";
import type { Block } from "@formforge/core/templates";

import TemplatePreview from "./template-preview";

const CATEGORY_LABEL: Record<string, string> = {
  form: "Form",
  page: "Landing page",
  portfolio: "Portfolio",
};

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

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <nav aria-label="Breadcrumb" className="mb-8 text-sm">
        <Link href="/templates" className="text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-fg)]">
          ← All templates
        </Link>
      </nav>

      <header className="flex flex-col gap-8 border-b border-[var(--ff-border)] pb-10 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ff-badge ff-badge--accent">{CATEGORY_LABEL[meta.category] ?? meta.category}</span>
            {meta.tags.map((tag) => (
              <span key={tag} className="ff-badge ff-badge--muted">
                {tag}
              </span>
            ))}
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance text-[var(--ff-fg)] sm:text-4xl">
            {meta.name}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-[var(--ff-muted)]">{meta.description}</p>
          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs font-medium text-[var(--ff-muted)]">Blocks</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ff-fg)]">{blockCount}</dd>
            </div>
            {meta.category === "form" && (
              <div>
                <dt className="text-xs font-medium text-[var(--ff-muted)]">Questions</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ff-fg)]">{questionCount}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium text-[var(--ff-muted)]">Logic</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ff-fg)]">
                {body.logic.rules.length > 0 ? `${body.logic.rules.length} rules` : "none"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[var(--ff-muted)]">Fonts</dt>
              <dd className="mt-0.5 text-sm font-semibold text-[var(--ff-fg)]">
                {body.theme.fontHeading} / {body.theme.fontBody}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2">
          {/* "Use template" — the authenticated create flow (spec §14.1.2) picks up ?template= */}
          <Link href={`/dashboard?template=${meta.id}`} className="ff-btn ff-btn-primary shadow-sm transition-colors">
            Use this template
          </Link>
          <p className="max-w-56 text-center text-xs leading-relaxed text-[var(--ff-muted)]">
            Copies into your workspace as an editable draft.
          </p>
        </div>
      </header>

      <section aria-label="Template preview" className="mt-10">
        <h2 className="mb-4 text-sm font-medium text-[var(--ff-muted)]">Preview</h2>
        <TemplatePreview body={body} />
      </section>

      <section aria-label="Blocks included" className="mt-12">
        <h2 className="mb-3 text-sm font-medium text-[var(--ff-muted)]">What&apos;s inside</h2>
        <ul className="flex flex-wrap gap-2">
          {Array.from(kinds).map((kind) => (
            <li
              key={kind}
              className="rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-card)] px-3 py-1.5 font-mono text-xs text-[var(--ff-muted)]"
            >
              {kind}
            </li>
          ))}
        </ul>
        {meta.category === "form" && body.endings.length > 0 && (
          <p className="mt-4 text-sm leading-relaxed text-[var(--ff-muted)]">
            Ends on {body.endings.length} screen{body.endings.length === 1 ? "" : "s"}:{" "}
            {body.endings.map((e) => `“${e.title}”`).join(", ")}.
          </p>
        )}
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
