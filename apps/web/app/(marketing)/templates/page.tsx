// Template gallery: /templates (spec §14.1.9, issue #22).
// Server component; category filtering via search params (no client JS).
import type { Metadata } from "next";
import Link from "next/link";

import { listTemplates } from "@formforge/core/templates";
import type { TemplateCategory } from "@formforge/core/templates";

import TemplateCard from "./template-card";

export const metadata: Metadata = {
  title: "Templates — FormForge",
  description: "Ready-made forms, landing pages and portfolios. Start from a template, make it yours in minutes.",
};

const FILTERS: { key: TemplateCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "form", label: "Forms" },
  { key: "page", label: "Landing pages" },
  { key: "portfolio", label: "Portfolios" },
];

const CATEGORY_SINGULAR: Record<TemplateCategory, string> = {
  form: "form",
  page: "landing page",
  portfolio: "portfolio",
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const active = FILTERS.some((f) => f.key === category) ? (category as TemplateCategory | "all") : "all";
  const templates = listTemplates(active === "all" ? {} : { category: active });

  const countLabel =
    active === "all"
      ? "hand-built templates"
      : `hand-built ${CATEGORY_SINGULAR[active]} template${templates.length === 1 ? "" : "s"}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <header className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">Start from a template</h1>
        <p className="mt-3 text-lg leading-relaxed text-[var(--ff-muted)]">
          <span className="tabular-nums">{templates.length}</span> {countLabel} with original copy, working logic and
          on-brand themes. Pick one, connect your form, publish.
        </p>
      </header>

      <nav aria-label="Filter by category" className="mt-8 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = f.key === active;
          const href = f.key === "all" ? "/templates" : `/templates?category=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--ff-fg)] text-[var(--ff-bg)]"
                  : "border border-[var(--ff-border)] text-[var(--ff-muted)] hover:border-[var(--ff-muted)] hover:text-[var(--ff-fg)]"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {templates.length === 0 ? (
        <p className="mt-12 rounded-[var(--ff-radius)] border border-dashed border-[var(--ff-border)] bg-[var(--ff-card)] p-10 text-center text-sm text-[var(--ff-muted)]">
          No templates in this category yet — try another filter.
        </p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
      )}
    </main>
  );
}
