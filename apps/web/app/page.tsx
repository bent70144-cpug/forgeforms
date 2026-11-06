// FormForge marketing home (Hallmark redesign, Coral theme).
// Server component; the only client island is the hero desk demo.
// Every link below is a real route; every fact comes from the product
// (README / spec). No invented metrics, quotes or logos.

import type { Metadata } from "next";
import Link from "next/link";

import { DeskDemo } from "@/components/landing/desk-demo";

export const metadata: Metadata = {
  title: "FormForge — forms, landing pages and portfolios from one document",
  description:
    "Author a document once in FormForge, then publish it as a conversational form, a scroll page or an embeddable widget.",
};

const MOMENTS = [
  {
    title: "The block editor",
    body: "Content, question, layout and action families, with autosave and full undo history. Drag a block, the document is already saved.",
    fig: "23 block kinds",
  },
  {
    title: "The logic engine",
    body: "Conditions, jumps and validation evaluated per respondent. The document itself never changes; the path through it does.",
    fig: null,
  },
  {
    title: "Results and analytics",
    body: "Every submission lands in a searchable inbox, with trends, drop-off panels and CSV export when you need the raw data.",
    fig: null,
  },
  {
    title: "The AI workbench",
    body: "Draft a whole document from a prompt, then refine it block by block in the same editor you write in by hand.",
    fig: null,
  },
  {
    title: "The MCP server and the API",
    body: "Scoped tools let agents read and drive documents; a versioned, error-coded REST API covers everything else.",
    fig: "7 MCP tools",
  },
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

export default function Home() {
  return (
    <div className="ff-land">
      {/* Nav: edge-aligned, one line */}
      <header className="ff-land-container">
        <nav className="ff-land-nav" aria-label="Main">
          <Link href="/" className="ff-land-wordmark">
            FormForge
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
        {/* Hero: Stage posture, text on five columns, the desk on seven */}
        <section className="ff-land-container" aria-labelledby="ff-land-hero-h1">
          <div className="ff-land-hero">
            <div className="ff-land-hero-copy">
              <h1 className="ff-land-h1" id="ff-land-hero-h1">
                One document, published every way
              </h1>
              <p className="ff-land-lead">
                Author the blocks once; ship a form, a page or an embed.
              </p>
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
              <p className="ff-land-small">Free to start.</p>
            </div>
            <DeskDemo />
          </div>
        </section>

        {/* Rows: the five named moments, parted by hairlines */}
        <section className="ff-land-section" aria-labelledby="ff-land-moments">
          <div className="ff-land-container">
            <h2 className="ff-land-h2" id="ff-land-moments">
              What the document can do
            </h2>
            <div className="ff-land-rows">
              {MOMENTS.map((moment) => (
                <div className="ff-land-row" key={moment.title}>
                  <h3>{moment.title}</h3>
                  <div>
                    <p>{moment.body}</p>
                    {moment.fig !== null && (
                      <p className="ff-land-fig">{moment.fig}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Split: the envelope scene and your own domain */}
        <section className="ff-land-section" aria-labelledby="ff-land-domain">
          <div className="ff-land-container">
            <div className="ff-land-split">
              <div className="ff-land-envelope-scene" aria-hidden="true">
                <div className="ff-land-replycard ff-land-replycard--a">
                  Response
                </div>
                <div className="ff-land-replycard ff-land-replycard--b">
                  Response
                </div>
                <div className="ff-land-envelope">
                  <div className="ff-land-envelope-stamp" />
                  <div className="ff-land-envelope-address">
                    Ana Ferreira
                    <br />
                    <strong>forms.example.com</strong>
                    <br />
                    Attn: submissions inbox
                  </div>
                </div>
              </div>
              <div className="ff-land-split-copy">
                <h2 className="ff-land-h2" id="ff-land-domain">
                  Your address on the internet
                </h2>
                <p className="ff-land-lead">
                  Your domain, verified and routed to the right document.
                </p>
                <dl className="ff-land-facts">
                  {TENANCY_FACTS.map((fact) => (
                    <div key={fact.term}>
                      <dt>{fact.term}</dt>
                      <dd>{fact.detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* The board close: the job, in the form the job takes */}
        <section className="ff-land-band" aria-labelledby="ff-land-close-h2">
          <div className="ff-land-container">
            <div className="ff-land-close">
              <h2 className="ff-land-h2" id="ff-land-close-h2">
                Author once. Publish everywhere.
              </h2>
              <Link href="/register" className="ff-land-btn ff-land-btn--card">
                Start free
              </Link>
              <p className="ff-land-close-note">Free to start.</p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer: colophon under a hairline */}
      <footer className="ff-land-footer">
        <div className="ff-land-container">
          <hr className="ff-land-footer-rule" />
          <div className="ff-land-footer-row">
            <span className="ff-land-wordmark">FormForge</span>
            <nav className="ff-land-footer-links" aria-label="Footer">
              <Link href="/templates">Templates</Link>
              <Link href="/dpa">DPA</Link>
              <Link href="/report-abuse">Report abuse</Link>
              <Link href="/login">Log in</Link>
              <a href="https://github.com/bent70144-cpug/forgeforms">GitHub</a>
            </nav>
          </div>
          <p className="ff-land-legal">© 2026 FormForge</p>
        </div>
      </footer>
    </div>
  );
}
