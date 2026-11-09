// Template gallery: /templates (spec §14.1.9, issue #22).
// Server component; category filtering via search params (no client JS).
// Reveal is progressive enhancement only: without JS (or with reduced motion)
// the grid renders fully visible as plain paper cards.
import type { Metadata } from "next";
import Link from "next/link";

import { listTemplates } from "@formforge/core/templates";
import type { TemplateCategory } from "@formforge/core/templates";

import TemplateCard from "./template-card";
import Reveal from "@/components/landing/reveal";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { BTN_SECONDARY_SM } from "@/lib/ui";

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

// Editorial filter row: quiet text links between hairlines. The active filter
// carries a 2px ultramarine underline; touch targets stay ≥44px on small
// screens (min-h) and collapse to text height from sm up. Count rides on the
// right in mono tabular figures.
const FILTER_LINK =
  "inline-flex min-h-[2.5rem] items-center text-sm font-medium no-underline transition-colors duration-200 motion-reduce:transition-none sm:min-h-0";
const FILTER_IDLE =
  "text-[var(--ff-muted)] hover:text-[var(--ff-fg)] hover:underline hover:decoration-[var(--ff-primary)] hover:decoration-2 hover:underline-offset-[6px]";
const FILTER_ACTIVE =
  "text-[var(--ff-fg)] underline decoration-[var(--ff-primary)] decoration-2 underline-offset-[6px]";

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
    <main className="mx-auto w-full max-w-6xl px-[clamp(1rem,3vw,1.5rem)] py-12 sm:py-14">
      {/* Masthead: terracotta kicker, Sora title, open paper — no panel, no
          gradient wash; the type does the work. */}
      <section aria-labelledby="templates-title">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ff-accent)]">
          Template library
        </p>
        <h1
          id="templates-title"
          className="mt-3 max-w-[26ch] text-balance text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.12] tracking-[-0.02em] text-[var(--ff-fg)] [font-family:var(--ff-font-heading)]"
        >
          Start from a template
        </h1>
        <p className="mt-4 max-w-[56ch] text-lg leading-relaxed text-[var(--ff-muted)]">
          Ready-made documents for forms, pages and portfolios — original copy, on-brand themes, working logic where
          it earns its place, and analytics built in. Pick one, make it yours, publish.
        </p>
      </section>

      <nav
        aria-label="Filter by category"
        className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-1 border-y border-[var(--ff-border)] py-2"
      >
        {FILTERS.map((f) => {
          const isActive = f.key === active;
          const href = f.key === "all" ? "/templates" : `/templates?category=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`${FILTER_LINK} ${isActive ? FILTER_ACTIVE : FILTER_IDLE}`}
            >
              {f.label}
            </Link>
          );
        })}
        <p className="m-0 ml-auto text-xs tabular-nums text-[var(--ff-muted)] [font-family:var(--ff-font-mono)]">
          {templates.length} {countNoun}
        </p>
      </nav>

      {templates.length === 0 ? (
        <div className="mt-8">
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
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
