// Marketing home page (replaces the T01 scaffold placeholder).
// Fully static — no DB, no session reads — so it renders on any host even
// before infrastructure env vars are provisioned. Content mirrors the
// shipped feature set (see README.md); everything linked exists as a route.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FormForge — Forms, landing pages and portfolios",
  description:
    "Author once as a block document, publish as a scroll page, a conversational form, or an embeddable widget. Forms, landing pages and portfolios on one model.",
};

const PLANES = [
  {
    label: "Scroll page",
    copy: "Server-rendered page for landing sites and portfolios — fast first paint, SEO-friendly.",
    tag: "content + layout blocks",
  },
  {
    label: "Conversational form",
    copy: "The same document, played back one question at a time on the client — lower drop-off.",
    tag: "question blocks",
  },
  {
    label: "Embed widget",
    copy: "Drop the document into any site with a sandboxed iframe embed and a publish-safe protocol.",
    tag: "embed protocol",
  },
] as const;

const FEATURES = [
  {
    title: "Block editor",
    copy: "23 block kinds across content, question, layout and action families — drag and drop, autosave, full undo/redo history.",
  },
  {
    title: "Logic engine",
    copy: "Conditional visibility, jumps and validation that evaluate per respondent, without touching the document model.",
  },
  {
    title: "Results & analytics",
    copy: "Every submission lands in a searchable inbox with trends, drop-off panels and CSV export built in.",
  },
  {
    title: "AI workbench",
    copy: "Draft a complete document from a prompt, then refine it block by block in the same editor.",
  },
  {
    title: "MCP server & public API",
    copy: "Drive FormForge from agents and automations: a scoped MCP server plus a versioned, error-coded REST API.",
  },
  {
    title: "Multi-tenant by design",
    copy: "Workspaces, verified custom domains and per-document publish controls — with GDPR export and abuse reporting.",
  },
] as const;

const STEPS = [
  {
    n: "1",
    title: "Author",
    copy: "Assemble blocks into one document — content, questions, layout and actions.",
  },
  {
    n: "2",
    title: "Publish",
    copy: "Choose a render plane: share a link, wire a custom domain, or embed the widget.",
  },
  {
    n: "3",
    title: "Measure",
    copy: "Watch submissions arrive, read the analytics, export when you need the data.",
  },
] as const;

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--ff-bg)] text-[var(--ff-fg)]">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ff-primary)] text-sm font-bold text-[var(--ff-primary-fg)]"
          >
            Ff
          </span>
          FormForge
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2 text-sm">
          <Link
            href="/templates"
            className="rounded-lg px-3 py-2 text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-fg)]"
          >
            Templates
          </Link>
          <Link
            href="/login"
            className="rounded-lg px-3 py-2 text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-fg)]"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-[var(--ff-primary)] px-4 py-2 font-medium text-[var(--ff-primary-fg)] transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-14 text-center sm:pt-20">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--ff-border)] bg-[var(--ff-card)] px-4 py-1.5 text-xs font-medium text-[var(--ff-muted)]">
            One block document — three render planes
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Forms, landing pages and portfolios — from a single document.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--ff-muted)]">
            FormForge authors every publishable surface as one block document. Render it as a
            scroll page, run it as a conversational form, or embed it anywhere — no rebuilds in
            between.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="rounded-xl bg-[var(--ff-primary)] px-6 py-3 font-medium text-[var(--ff-primary-fg)] transition-opacity hover:opacity-90"
            >
              Create your account
            </Link>
            <Link
              href="/templates"
              className="rounded-xl border border-[var(--ff-border)] bg-[var(--ff-card)] px-6 py-3 font-medium transition-colors hover:border-[var(--ff-primary)]"
            >
              Browse templates
            </Link>
          </div>
        </section>

        {/* Render planes */}
        <section
          aria-labelledby="planes-heading"
          className="mx-auto max-w-6xl px-6 pb-20"
        >
          <h2 id="planes-heading" className="sr-only">
            Render planes
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {PLANES.map((plane) => (
              <article
                key={plane.label}
                className="rounded-2xl border border-[var(--ff-border)] bg-[var(--ff-card)] p-6"
              >
                <h3 className="text-lg font-semibold">{plane.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
                  {plane.copy}
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-[var(--ff-primary)]">
                  {plane.tag}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Features */}
        <section
          aria-labelledby="features-heading"
          className="border-y border-[var(--ff-border)] bg-[var(--ff-card)]/50"
        >
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2
              id="features-heading"
              className="text-center text-3xl font-bold tracking-tight"
            >
              Everything around the same document
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-[var(--ff-muted)]">
              The block document is the source of truth — editor, logic, analytics and APIs all
              operate on it.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-2xl border border-[var(--ff-border)] bg-[var(--ff-card)] p-6"
                >
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
                    {feature.copy}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="mx-auto max-w-6xl px-6 py-16">
          <h2 id="how-heading" className="text-center text-3xl font-bold tracking-tight">
            Author, publish, measure
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <article key={step.n} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ff-border)] bg-[var(--ff-card)] font-semibold text-[var(--ff-primary)]"
                >
                  {step.n}
                </span>
                <div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
                    {step.copy}
                  </p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link
              href="/register"
              className="inline-block rounded-xl bg-[var(--ff-primary)] px-6 py-3 font-medium text-[var(--ff-primary-fg)] transition-opacity hover:opacity-90"
            >
              Start building — it takes a minute
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--ff-border)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-[var(--ff-muted)] sm:flex-row">
          <p>© 2026 FormForge</p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-5">
            <Link href="/templates" className="transition-colors hover:text-[var(--ff-fg)]">
              Templates
            </Link>
            <Link href="/dpa" className="transition-colors hover:text-[var(--ff-fg)]">
              DPA
            </Link>
            <Link
              href="/report-abuse"
              className="transition-colors hover:text-[var(--ff-fg)]"
            >
              Report abuse
            </Link>
            <a
              href="https://github.com/bent70144-cpug/forgeforms"
              className="transition-colors hover:text-[var(--ff-fg)]"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
