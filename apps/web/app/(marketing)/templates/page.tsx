// Template gallery: /templates (spec §14.1.9, issue #22).
// Server component; category filtering via search params (no client JS).
// Reveal is progressive enhancement only: without JS (or with reduced motion)
// the grid renders fully visible as plain glass cards.
import type { Metadata } from "next";
import Link from "next/link";

import { listTemplates } from "@formforge/core/templates";
import type { TemplateCategory, TemplateSummary } from "@formforge/core/templates";

import Reveal from "@/components/landing/reveal";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icons";
import { BADGE_ACCENT, BADGE_MUTED, BTN_SECONDARY_SM } from "@/lib/ui";

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

const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  form: "Form",
  page: "Landing page",
  portfolio: "Portfolio",
};

const CATEGORY_ICON: Record<TemplateCategory, IconName> = {
  form: "list",
  page: "globe",
  portfolio: "grid",
};

// Refined filter pills: quiet glass chip by default, violet→cyan gradient pill
// when active. Hover motion is a 1px lift; colors ride the tokens so the light
// scheme flips automatically.
const PILL_BASE =
  "inline-flex min-h-[2.5rem] items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-[color,border-color,translate,box-shadow] duration-200 ease-out sm:min-h-0";
const PILL_IDLE =
  "border-[var(--ff-border-strong)] bg-[color-mix(in_srgb,var(--ff-card)_72%,transparent)] text-[var(--ff-muted)] hover:-translate-y-px hover:border-[color:color-mix(in_srgb,var(--ff-border-strong)_55%,var(--ff-fg))] hover:text-[var(--ff-fg)]";
const PILL_ACTIVE =
  "border-transparent text-[var(--ff-primary-fg)] shadow-[var(--ff-glow)] hover:-translate-y-px";

// Aurora glass gallery card. Hover motion is translate/box-shadow/border-color
// only and the violet glow comes from --ff-glow-soft; globals.css already
// collapses all of it under prefers-reduced-motion, and motion-reduce:*
// guards keep the static state for safety.
const TPL_CARD =
  "group relative flex h-full flex-col gap-3 overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-glass-border)] bg-[color-mix(in_srgb,var(--ff-card)_78%,transparent)] p-5 shadow-[var(--ff-shadow-sm)] backdrop-blur-sm transition-[translate,border-color,box-shadow] duration-200 ease-out hover:-translate-y-[3px] hover:border-[color:color-mix(in_srgb,var(--ff-primary)_42%,var(--ff-border))] hover:shadow-[var(--ff-glow-soft),var(--ff-shadow-md)] motion-reduce:transition-none motion-reduce:hover:translate-y-0";

function TemplateGalleryCard({ template }: { template: TemplateSummary }) {
  return (
    <Link
      href={`/templates/${template.id}`}
      className={TPL_CARD}
      aria-label={`${template.name} — ${CATEGORY_LABEL[template.category]} template`}
    >
      {/* gradient hairline that lights up on hover (opacity only) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
        style={{ backgroundImage: "var(--ff-grad)" }}
      />

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--ff-primary-fg)] shadow-[var(--ff-glow)]"
          style={{ backgroundImage: "var(--ff-grad)" }}
        >
          <Icon name={CATEGORY_ICON[template.category]} size={18} />
        </span>
        <h2 className="m-0 min-w-0 flex-1 text-[15px] font-semibold leading-snug text-[var(--ff-fg)] transition-colors duration-200 group-hover:text-[var(--ff-accent-soft)]">
          {template.name}
        </h2>
        <Icon
          name="arrowRight"
          size={16}
          className="mt-0.5 shrink-0 -translate-x-1 text-[var(--ff-accent)] opacity-0 transition-[opacity,translate] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
        />
      </div>

      <p className="m-0 line-clamp-2 flex-1 text-sm leading-relaxed text-[var(--ff-muted)]">
        {template.description}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={BADGE_MUTED}>{CATEGORY_LABEL[template.category]}</span>
        {template.hasLogic && <span className={BADGE_ACCENT}>+ Logic</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--ff-border)] pt-3 text-xs tabular-nums text-[var(--ff-muted)]">
        <span>{template.blockCount} blocks</span>
        {template.questionCount > 0 && <span>{template.questionCount} questions</span>}
        {template.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-2 py-0.5 font-medium"
          >
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}

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
      {/* Hero strip: glass panel over the body's aurora field, gradient accent word */}
      <section
        aria-labelledby="templates-title"
        className="relative overflow-hidden rounded-[calc(var(--ff-radius)*1.5)] border border-[var(--ff-glass-border)] bg-[color-mix(in_srgb,var(--ff-card)_70%,transparent)] p-6 backdrop-blur-md sm:p-10"
        style={{
          backgroundImage:
            "radial-gradient(36rem 18rem at 85% -30%, color-mix(in srgb, var(--ff-primary) 20%, transparent), transparent 65%), radial-gradient(28rem 16rem at 8% 130%, color-mix(in srgb, var(--ff-accent) 12%, transparent), transparent 60%)",
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-10 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--ff-primary) 60%, transparent), color-mix(in srgb, var(--ff-accent) 50%, transparent), transparent)",
          }}
        />
        <div className="relative">
          <span className="ff-chip">
            <Icon name="sparkles" size={13} className="text-[var(--ff-accent)]" />
            Template library
          </span>
          <h1
            id="templates-title"
            className="mt-4 text-balance text-4xl font-semibold tracking-tight text-[var(--ff-fg)] sm:text-[2.75rem] sm:leading-[1.1]"
          >
            Start from a{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--ff-grad)" }}
            >
              template
            </span>
          </h1>
          <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-[var(--ff-muted)]">
            Ready-made documents for forms, pages and portfolios — original copy, on-brand themes, working logic where
            it earns its place, and analytics built in. Pick one, make it yours, publish.
          </p>
        </div>
      </section>

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
              style={isActive ? { backgroundImage: "var(--ff-grad)" } : undefined}
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
              <TemplateGalleryCard template={t} />
            </Reveal>
          ))}
        </div>
      )}
    </main>
  );
}
