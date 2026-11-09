// FormForge marketing home (Aurora Glass redesign, 2026).
// Server component; the only interactive island is the hero desk demo.
// Every link below is a real route; every fact comes from the product
// (README / spec / template library). No invented metrics, quotes or logos.

import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";

import { DeskDemo } from "@/components/landing/desk-demo";
import Reveal from "@/components/landing/reveal";
import SpotlightCard from "@/components/landing/spotlight-card";

export const metadata: Metadata = {
  title: "FormForge — forms, landing pages and portfolios from one document",
  description:
    "Author a document once in FormForge, then publish it as a conversational form, a scroll page or an embeddable widget.",
};

/* --- content (product facts only) ---------------------------------------- */

const FEATURES = [
  {
    icon: "blocks",
    title: "The block editor",
    body: "Content, question, layout and action families, with autosave and full undo history. Drag a block, the document is already saved.",
    fig: "23 block kinds",
  },
  {
    icon: "branch",
    title: "The logic engine",
    body: "Conditions, jumps and validation evaluated per respondent. The document itself never changes; the path through it does.",
    fig: null,
  },
  {
    icon: "chart",
    title: "Results and analytics",
    body: "Every submission lands in a searchable inbox, with trends, drop-off panels and CSV export when you need the raw data.",
    fig: null,
  },
  {
    icon: "spark",
    title: "The AI workbench",
    body: "Draft a whole document from a prompt, then refine it block by block in the same editor you write in by hand.",
    fig: null,
  },
  {
    icon: "terminal",
    title: "The MCP server and the API",
    body: "Scoped tools let agents read and drive documents; a versioned, error-coded REST API covers everything else.",
    fig: "7 MCP tools",
  },
] as const;

const TEMPLATES = [
  {
    slug: "event-rsvp",
    tag: "Form",
    name: "Event RSVP",
    desc: "Collect RSVPs for meetups and launches, with guests counted automatically.",
    grad: "linear-gradient(135deg, #34d399, #22d3ee)",
  },
  {
    slug: "product-landing",
    tag: "Landing page",
    name: "SaaS product landing",
    desc: "A dark, confident launch page: hero, feature pitch, pricing and FAQ.",
    grad: "linear-gradient(135deg, #6366f1, #6c5cff)",
  },
  {
    slug: "designer-portfolio",
    tag: "Portfolio",
    name: "Product designer portfolio",
    desc: "Case-study-first portfolio with selected work and an embedded inquiry form.",
    grad: "linear-gradient(135deg, #a855f7, #6c5cff)",
  },
] as const;

const STEPS = [
  {
    title: "Author",
    body: "Draft the document in the block editor — by hand, or from a prompt in the AI workbench.",
  },
  {
    title: "Publish",
    body: "Ship it as a conversational form, a scroll page or an embeddable widget — on our domain or yours.",
  },
  {
    title: "Collect",
    body: "Every response lands in a searchable inbox, with trends, drop-off panels and CSV export.",
  },
] as const;

const PROOF = [
  { fig: "23", label: "block kinds" },
  { fig: "7", label: "MCP tools" },
  { fig: "REST", label: "versioned API" },
  { fig: "GDPR", label: "data export" },
] as const;

const TENANCY_FACTS = [
  {
    term: "Workspaces",
    detail: "Your documents and submissions, separated by tenant.",
  },
  {
    term: "Custom domains",
    detail: "Verify a domain and publish to it; routing checks it first.",
  },
  {
    term: "Export and reporting",
    detail: "GDPR export for your data, abuse reporting on every page.",
  },
] as const;

/* --- inline icons (stroke glyphs; no asset files) -------------------------- */

type IconProps = { size?: number };

function IconGlyph({ name, size = 20 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "blocks":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="6" height="6" rx="1.5" />
          <rect x="11" y="3" width="6" height="6" rx="1.5" />
          <rect x="3" y="11" width="6" height="6" rx="1.5" />
          <path d="M14 11.5v5M11.5 14h5" />
        </svg>
      );
    case "branch":
      return (
        <svg {...common}>
          <circle cx="5.5" cy="5" r="2" />
          <circle cx="5.5" cy="15" r="2" />
          <circle cx="14.5" cy="8" r="2" />
          <path d="M5.5 7v6M7.5 5.6c3 .6 4 1.4 5 2.4M5.5 13c0-2.5 3-3.5 7-3.5" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M3 3v14h14" />
          <path d="M7 13v-3M11 13V7M15 13v-5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M10 3l1.6 4.2L16 8.8l-4.4 1.6L10 14.6 8.4 10.4 4 8.8l4.4-1.6L10 3Z" />
          <path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
          <path d="M6 8l2.5 2L6 12M10.5 12.5H14" />
        </svg>
      );
    default:
      return null;
  }
}

function IconArrow({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="ff-land">
      {/* the aurora field behind everything */}
      <div className="ff-land-aurora" aria-hidden="true">
        <span className="ff-land-aurora-blob ff-land-aurora-blob--1" />
        <span className="ff-land-aurora-blob ff-land-aurora-blob--2" />
        <span className="ff-land-aurora-blob ff-land-aurora-blob--3" />
      </div>

      {/* Nav: sticky glass, gradient wordmark */}
      <header className="ff-land-header">
        <nav className="ff-land-container ff-land-nav" aria-label="Main">
          <Link href="/" className="ff-land-wordmark">
            <span className="ff-land-logo-mark" aria-hidden="true" />
            Form<span className="ff-land-wordmark-grad">Forge</span>
          </Link>
          <div className="ff-land-nav-links">
            <Link href="/templates" className="ff-land-nav-link">
              Templates
            </Link>
            <Link href="/login" className="ff-land-nav-link">
              Log in
            </Link>
            <Link
              href="/register"
              className="ff-land-btn ff-land-btn--card ff-land-nav-cta"
            >
              Start free
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero: gradient display headline + the desk demo under an aurora glow */}
        <section className="ff-land-container" aria-labelledby="ff-land-hero-h1">
          <div className="ff-land-hero">
            <div className="ff-land-hero-copy">
              <Reveal>
                <p className="ff-land-pill">
                  <span className="ff-land-pill-dot" aria-hidden="true" />
                  Draft with AI, refine by hand
                </p>
              </Reveal>
              <Reveal step={1}>
                <h1 className="ff-land-h1" id="ff-land-hero-h1">
                  One document,{" "}
                  <span className="ff-land-grad-text">published every way</span>
                </h1>
              </Reveal>
              <Reveal step={2}>
                <p className="ff-land-lead">
                  Author the blocks once — then ship the same document as a
                  conversational form, a scroll page or an embeddable widget.
                </p>
              </Reveal>
              <Reveal step={3}>
                <div className="ff-land-hero-actions">
                  <Link href="/register" className="ff-land-btn ff-land-btn--ink">
                    Start free
                  </Link>
                  <Link
                    href="/templates"
                    className="ff-land-btn ff-land-btn--card"
                  >
                    Browse templates
                  </Link>
                </div>
              </Reveal>
              <p className="ff-land-small">Free to start.</p>
            </div>
            <Reveal step={1} className="ff-land-hero-demo">
              <DeskDemo />
            </Reveal>
          </div>
        </section>

        {/* Social proof: product facts, parted by hairlines */}
        <section className="ff-land-container" aria-label="FormForge in numbers">
          <Reveal>
            <ul className="ff-land-proof">
              {PROOF.map((fact) => (
                <li key={fact.label}>
                  <span className="ff-land-proof-fig">{fact.fig}</span>
                  <span className="ff-land-proof-label">{fact.label}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* Features: the five named moments on spotlight cards */}
        <section className="ff-land-section" aria-labelledby="ff-land-moments">
          <div className="ff-land-container">
            <div className="ff-land-sect-head">
              <Reveal>
                <p className="ff-land-eyebrow">One block model</p>
              </Reveal>
              <Reveal step={1}>
                <h2 className="ff-land-h2" id="ff-land-moments">
                  What the document can do
                </h2>
              </Reveal>
              <Reveal step={2}>
                <p className="ff-land-lead">
                  Five surfaces, one document underneath them all.
                </p>
              </Reveal>
            </div>
            <div className="ff-land-cards">
              {FEATURES.map((feature, i) => (
                <Reveal
                  key={feature.title}
                  step={i % 4}
                  className="ff-land-feature-cell"
                >
                  <SpotlightCard className="ff-land-feature">
                    <span className="ff-land-feature-icon" aria-hidden="true">
                      <IconGlyph name={feature.icon} />
                    </span>
                    <h3 className="ff-land-feature-title">{feature.title}</h3>
                    <p className="ff-land-feature-body">{feature.body}</p>
                    {feature.fig !== null && (
                      <p className="ff-land-feature-fig">{feature.fig}</p>
                    )}
                  </SpotlightCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Template showcase: real templates, CSS mini-previews */}
        <section
          className="ff-land-section"
          aria-labelledby="ff-land-templates-h2"
        >
          <div className="ff-land-container">
            <div className="ff-land-sect-head ff-land-sect-head--split">
              <div className="ff-land-sect-head-copy">
                <Reveal>
                  <p className="ff-land-eyebrow">Start from a template</p>
                </Reveal>
                <Reveal step={1}>
                  <h2 className="ff-land-h2" id="ff-land-templates-h2">
                    Steal a head start
                  </h2>
                </Reveal>
                <Reveal step={2}>
                  <p className="ff-land-lead">
                    Ready-made documents with original copy and working logic.
                    Pick one, make it yours.
                  </p>
                </Reveal>
              </div>
              <Reveal step={3}>
                <Link href="/templates" className="ff-land-sect-link">
                  Browse all templates
                  <IconArrow />
                </Link>
              </Reveal>
            </div>
            <div className="ff-land-tpl-grid">
              {TEMPLATES.map((tpl, i) => (
                <Reveal key={tpl.slug} step={i} className="ff-land-tpl-cell">
                  <Link
                    href={`/templates/${tpl.slug}`}
                    className="ff-land-tpl-card"
                  >
                    <span
                      className="ff-land-tpl-preview"
                      style={{ "--tpl-grad": tpl.grad } as CSSProperties}
                      aria-hidden="true"
                    >
                      <span className="ff-land-tpl-chrome">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="ff-land-tpl-bar ff-land-tpl-bar--grad" />
                      <span className="ff-land-tpl-bar ff-land-tpl-bar--lg" />
                      <span className="ff-land-tpl-bar ff-land-tpl-bar--md" />
                      <span className="ff-land-tpl-bar ff-land-tpl-bar--sm" />
                    </span>
                    <span className="ff-land-tpl-tag">{tpl.tag}</span>
                    <span className="ff-land-tpl-name">{tpl.name}</span>
                    <span className="ff-land-tpl-desc">{tpl.desc}</span>
                    <span className="ff-land-tpl-cta">
                      Use template
                      <IconArrow size={14} />
                    </span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* How it works: three steps, joined by a dashed line */}
        <section className="ff-land-section" aria-labelledby="ff-land-how-h2">
          <div className="ff-land-container">
            <div className="ff-land-sect-head">
              <Reveal>
                <p className="ff-land-eyebrow">How it works</p>
              </Reveal>
              <Reveal step={1}>
                <h2 className="ff-land-h2" id="ff-land-how-h2">
                  From first block to first response
                </h2>
              </Reveal>
            </div>
            <ol className="ff-land-steps">
              {STEPS.map((step, i) => (
                <li key={step.title} className="ff-land-step-cell">
                  <Reveal step={i}>
                    <div className="ff-land-step">
                      <span className="ff-land-step-num" aria-hidden="true">
                        {i + 1}
                      </span>
                      <h3 className="ff-land-step-title">{step.title}</h3>
                      <p className="ff-land-step-body">{step.body}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Your own domain: the tenancy facts */}
        <section className="ff-land-section" aria-labelledby="ff-land-domain">
          <div className="ff-land-container">
            <div className="ff-land-domain">
              <Reveal className="ff-land-domain-copy">
                <p className="ff-land-eyebrow">Tenancy</p>
                <h2 className="ff-land-h2" id="ff-land-domain">
                  Your address on the internet
                </h2>
                <p className="ff-land-lead">
                  Your domain, verified and routed to the right document.
                </p>
              </Reveal>
              <Reveal step={1}>
                <dl className="ff-land-facts">
                  {TENANCY_FACTS.map((fact) => (
                    <div className="ff-land-fact" key={fact.term}>
                      <dt>{fact.term}</dt>
                      <dd>{fact.detail}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>
          </div>
        </section>

        {/* The close: glass band with a gradient edge glow */}
        <section className="ff-land-section" aria-labelledby="ff-land-close-h2">
          <div className="ff-land-container">
            <Reveal>
              <div className="ff-land-close">
                <h2 className="ff-land-h2" id="ff-land-close-h2">
                  Author once.{" "}
                  <span className="ff-land-grad-text">Publish everywhere.</span>
                </h2>
                <p className="ff-land-lead">
                  Start from a template or a blank page — free to start.
                </p>
                <div className="ff-land-hero-actions ff-land-close-actions">
                  <Link
                    href="/register"
                    className="ff-land-btn ff-land-btn--ink ff-land-btn--lg"
                  >
                    Start free
                  </Link>
                  <Link
                    href="/templates"
                    className="ff-land-btn ff-land-btn--card"
                  >
                    Browse templates
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Footer: colophon under a gradient hairline */}
      <footer className="ff-land-footer">
        <div className="ff-land-container">
          <div className="ff-land-footer-row">
            <div className="ff-land-footer-brand">
              <span className="ff-land-wordmark">
                <span className="ff-land-logo-mark" aria-hidden="true" />
                Form<span className="ff-land-wordmark-grad">Forge</span>
              </span>
              <p className="ff-land-footer-tag">
                Forms, landing pages and portfolios — one block-document model.
              </p>
            </div>
            <nav className="ff-land-footer-links" aria-label="Footer">
              <Link href="/templates">Templates</Link>
              <Link href="/dpa">DPA</Link>
              <Link href="/report-abuse">Report abuse</Link>
              <Link href="/login">Log in</Link>
              <a href="https://github.com/bent70144-cpug/forgeforms" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </div>
          <p className="ff-land-legal">© 2026 FormForge</p>
        </div>
      </footer>
    </div>
  );
}
