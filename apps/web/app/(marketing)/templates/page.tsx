// Template gallery: /templates (spec §14.1.9, issue #22).
// Server component; category filtering via search params (no client JS).
// Reveal + SpotlightCard are progressive enhancement only: without JS (or
// with reduced motion) the grid renders fully visible as plain bordered cards.
import type { Metadata } from "next";
import Link from "next/link";

import { listTemplates } from "@formforge/core/templates";
import type { TemplateCategory } from "@formforge/core/templates";

import Reveal from "@/components/landing/reveal";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { BTN_SECONDARY_SM } from "@/lib/ui";

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

// Refined filter pills: quiet card-surface chip by default, ink pill when
// active. Hover motion is a 1px lift; colors ride the tokens so dark mode
// flips automatically.
const PILL_BASE =
  "inline-flex min-h-[2.5rem] items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-[color,border-color,translate,box-shadow] duration-200 ease-out sm:min-h-0";
const PILL_IDLE =
  "border-[var(--ff-border-strong)] bg-[var(--ff-card)] text-[var(--ff-muted)] hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--ff-border-strong)_60%,var(--ff-fg))] hover:text-[var(--ff-fg)]";
const PILL_ACTIVE = "border-transparent bg-[var(--ff-primary)] text-[var(--ff-primary-fg)] shadow-sm";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const active = FILTERS.some((f) => f.key === category) ? (category as TemplateCategory | "all") : "all";
  const templates = listTemplates(active === "all" ? {} : { category: active });

  const countNoun =
    active === "all"
      ? templates.length === 1
        ? "template"
        : "templates"
      : `${CATEGORY_SINGULAR[active]} template${templates.length === 1 ? "" : "s"}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]">Templates</h1>
        <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-[var(--ff-muted)]">
          Ready-made documents for forms, pages and portfolios — original copy, on-brand themes, working logic where
          it earns its place, and analytics built in. Pick one, make it yours, publish.
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
              className={`${PILL_BASE} ${isActive ? PILL_ACTIVE : PILL_IDLE}`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <p className="mt-4 text-sm text-[var(--ff-muted)]">
        <span className="tabular-nums">{templates.length}</span> {countNoun}
      </p>

      {templates.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Icon name="search" size={20} />}
            title="No templates in this category"
            description="Try another filter, or view the whole library."
            action={
              <Link href="/templates" className={BTN_SECONDARY_SM}>
                <Icon name="arrowLeft" size={14} />
                Show all templates
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t, i) => (
            <Reveal key={t.id} step={i % 4} className="h-full">
              <TemplateCard template={t} />
            </Reveal>
          ))}
        </div>
      )}
    </main>
  );
}
