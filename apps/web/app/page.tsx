// Marketing home page: "one document, three planes".
// Server component at the top level. The interactive pieces are small client
// components under components/landing (plane demo, scroll reveal, spotlight
// cards, block marquee). All color and type run through the --ff-* tokens in
// app/globals.css; the landing styles are appended there. Content mirrors the
// shipped feature set, and every link points at a route that exists.

import type { Metadata } from "next";
import Link from "next/link";
import BlockMarquee from "@/components/landing/block-marquee";
import PlaneDemo from "@/components/landing/plane-demo";
import Reveal from "@/components/landing/reveal";
import SpotlightCard from "@/components/landing/spotlight-card";

export const metadata: Metadata = {
  title: "FormForge — Forms, landing pages and portfolios",
  description:
    "Author once as a block document, publish as a scroll page, a conversational form, or an embeddable widget. Forms, landing pages and portfolios on one model.",
};

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconEditor() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconLogic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <circle cx="6" cy="5.5" r="2.25" />
      <circle cx="6" cy="18.5" r="2.25" />
      <circle cx="18" cy="12" r="2.25" />
      <path d="M6 7.75v8.5M8.25 5.5H13a4.75 4.75 0 0 1 4.75 4.75v-.5" />
    </svg>
  );
}

function IconResults() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="M4.5 20V13M10 20V5.5M15.5 20v-9.5M21 20H3" />
    </svg>
  );
}

function IconAI() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6-5.6-1.9 5.6-1.9Z" />
      <path d="M19 16.5v4M17 18.5h4" />
    </svg>
  );
}

function IconApi() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="m8 7.5-4.5 4.5L8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.25 5l-2.5 14" />
    </svg>
  );
}

function IconDomains() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.2 3.75 5.15 3.75 8.5S14.4 18.3 12 20.5c-2.4-2.2-3.75-5.15-3.75-8.5S9.6 5.7 12 3.5Z" />
    </svg>
  );
}

const PLANES = [
  {
    name: "Scroll page",
    copy: "Server-rendered for speed and search engines.",
  },
  {
    name: "Conversational form",
    copy: "The same blocks, one question at a time.",
  },
  {
    name: "Embed widget",
    copy: "A sandboxed iframe on any host site.",
  },
] as const;

const FEATURES = [
  {
    icon: <IconEditor />,
    title: "Block editor",
    copy: "23 block kinds across content, question, layout and action families, with drag and drop, autosave and full undo history.",
  },
  {
    icon: <IconLogic />,
    title: "Logic engine",
    copy: "Conditional visibility, jumps and validation, evaluated per respondent without touching the document.",
  },
  {
    icon: <IconResults />,
    title: "Results and analytics",
    copy: "Submissions land in a searchable inbox with trends, drop-off panels and CSV export.",
  },
  {
    icon: <IconAI />,
    title: "AI workbench",
    copy: "Draft a whole document from a prompt, then refine it block by block in the same editor.",
  },
  {
    icon: <IconApi />,
    title: "API and MCP server",
    copy: "A versioned, error-coded REST API plus a scoped MCP server, so agents and automations can drive FormForge.",
  },
  {
    icon: <IconDomains />,
    title: "Workspaces and domains",
    copy: "Multi-tenant workspaces, verified custom domains, GDPR export and abuse reporting.",
  },
] as const;

const STEPS = [
  {
    title: "Author",
    copy: "Assemble blocks in the editor. The document is the single source of truth.",
  },
  {
    title: "Publish",
    copy: "Pick a plane: share a link, point a verified domain, or embed the widget.",
  },
  {
    title: "Measure",
    copy: "Submissions arrive in the inbox with trends and drop-off analytics. Export any time.",
  },
] as const;

export default function Home() {
  return (
    <div className="ff-home bg-[var(--ff-bg)] text-[var(--ff-fg)]">
      {/* Header */}
      <header className="ff-shell flex items-center justify-between gap-6 py-3">
        <Link href="/" aria-label="FormForge home" className={`ff-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:text-[var(--ff-fg)]`}>
          <span aria-hidden="true" className="ff-mark-glyph">
            Ff
          </span>
          FormForge
        </Link>
        <div className="flex items-center gap-2">
          <nav aria-label="Main" className="hidden items-center md:flex">
            <Link href="/templates" className={`ff-nav-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:text-[var(--ff-fg)]`}>
              Templates
            </Link>
            <Link href="/login" className={`ff-nav-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:text-[var(--ff-fg)]`}>
              Log in
            </Link>
          </nav>
          <Link href="/register" className={`ff-btn ff-btn-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:translate-y-px`}>
            Get started
          </Link>
        </div>
      </header>

      <main>
        {/* Hero: the plane demo is the signature */}
        <section className="ff-shell grid items-center gap-10 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
          <div>
            <h1 className="text-4xl font-bold leading-[1.05] tracking-[-0.025em] [text-wrap:balance] sm:text-5xl xl:text-6xl">
              Author once. Publish three ways.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--ff-muted)] [text-wrap:pretty]">
              Your document renders as a scroll page, a form, or an embed.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/register" className={`ff-btn ff-btn-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:translate-y-px`}>
                Start building
              </Link>
              <Link href="/templates" className={`ff-btn ff-btn-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:translate-y-px`}>
                Browse templates
              </Link>
            </div>
          </div>
          <PlaneDemo />
        </section>

        {/* Three planes, explained in one strip */}
        <section aria-labelledby="planes-heading" className="ff-shell pb-16 pt-16">
          <Reveal>
            <h2
              id="planes-heading"
              className="text-2xl font-semibold leading-[1.2] tracking-[-0.02em] [text-wrap:balance] sm:text-4xl"
            >
              One document, three planes
            </h2>
            <ul className="mt-8 grid gap-y-8 sm:grid-cols-3 sm:gap-x-8">
              {PLANES.map((plane) => (
                <li
                  key={plane.name}
                  className="border-t border-[var(--ff-border)] pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:first:border-l-0 sm:first:pl-0"
                >
                  <h3 className="text-base font-semibold leading-[1.4]">{plane.name}</h3>
                  <p className="mt-1.5 text-base leading-relaxed text-[var(--ff-muted)] [text-wrap:pretty]">
                    {plane.copy}
                  </p>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* Features with pointer-tracked spotlight cards */}
        <section
          aria-labelledby="features-heading"
          className="border-y border-[var(--ff-border)] bg-[var(--ff-card)]"
        >
          <div className="ff-shell py-16">
            <Reveal>
              <h2
                id="features-heading"
                className="max-w-2xl text-2xl font-semibold leading-[1.2] tracking-[-0.02em] [text-wrap:balance] sm:text-4xl"
              >
                Built around the document
              </h2>
            </Reveal>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature, index) => (
                <Reveal key={feature.title} className="h-full" step={index % 3}>
                  <SpotlightCard className="h-full">
                    <h3 className="flex items-center gap-2.5 text-[1.0625rem] font-semibold leading-[1.4]">
                      <span aria-hidden="true" className="ff-feature-icon">
                        {feature.icon}
                      </span>
                      {feature.title}
                    </h3>
                    <p className="mt-2.5 text-base leading-relaxed text-[var(--ff-muted)] [text-wrap:pretty]">
                      {feature.copy}
                    </p>
                  </SpotlightCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* The 23 block kinds, looping */}
        <section aria-labelledby="blocks-heading" className="ff-shell py-16">
          <Reveal>
            <h2
              id="blocks-heading"
              className="text-2xl font-semibold leading-[1.2] tracking-[-0.02em] [text-wrap:balance] sm:text-4xl"
            >
              Blocks for every job
            </h2>
            <div className="mt-8">
              <BlockMarquee />
            </div>
            <p className="mt-4 text-base leading-relaxed text-[var(--ff-muted)] [text-wrap:pretty]">
              From hero blocks to file uploads, every kind lives in one palette.
            </p>
          </Reveal>
        </section>

        {/* Author, publish, measure */}
        <section aria-labelledby="steps-heading" className="ff-shell pb-16">
          <Reveal>
            <h2
              id="steps-heading"
              className="text-2xl font-semibold leading-[1.2] tracking-[-0.02em] [text-wrap:balance] sm:text-4xl"
            >
              Author, publish, measure
            </h2>
            <ol className="ff-steps mt-10">
              {STEPS.map((step) => (
                <li key={step.title} className="ff-step">
                  <div>
                    <h3 className="text-base font-semibold leading-[1.4]">{step.title}</h3>
                    <p className="mt-1.5 text-base leading-relaxed text-[var(--ff-muted)] [text-wrap:pretty]">
                      {step.copy}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        {/* Closing band */}
        <section aria-labelledby="cta-heading" className="border-y border-[var(--ff-border)] bg-[var(--ff-card)]">
          <div className="ff-shell flex flex-col gap-6 py-16 sm:flex-row sm:items-center sm:justify-between">
            <Reveal>
              <h2
                id="cta-heading"
                className="max-w-md text-2xl font-semibold leading-[1.2] tracking-[-0.02em] [text-wrap:balance] sm:text-4xl"
              >
                Start with a blank document
              </h2>
              <p className="mt-2 max-w-md text-base leading-relaxed text-[var(--ff-muted)] [text-wrap:pretty]">
                One workspace, every plane, no rebuilds in between.
              </p>
            </Reveal>
            <Link href="/register" className={`ff-btn ff-btn-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:translate-y-px sm:shrink-0`}>
              Create your account
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="ff-shell flex flex-col gap-4 py-8 text-sm text-[var(--ff-muted)] sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 FormForge</p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/templates" className={`ff-footer-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:text-[var(--ff-fg)]`}>
            Templates
          </Link>
          <Link href="/dpa" className={`ff-footer-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:text-[var(--ff-fg)]`}>
            DPA
          </Link>
          <Link href="/report-abuse" className={`ff-footer-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:text-[var(--ff-fg)]`}>
            Report abuse
          </Link>
          <a
            href="https://github.com/bent70144-cpug/forgeforms"
            className={`ff-footer-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-primary)] active:text-[var(--ff-fg)]`}
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </footer>
    </div>
  );
}
