// Embed QA page: /embed/demo (issue #22 acceptance — "embed works on a plain
// HTML test page and auto-resizes height"). Loads the real loader script and
// mounts one embed per mode, the way a third-party host page would. While no
// public snapshot endpoint is deployed, frames show the graceful fallback view
// — which still exercises ff:ready / ff:height / ff:request-height end to end.
//
// QA: pass a real published doc id with ?doc=doc_xxxxxxxx to see live content.
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Script from "next/script";
import Link from "next/link";

import { BADGE_ACCENT } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Embed demo — FormForge",
  description: "Live demo of the FormForge embed loader: inline, popup and side tab.",
  robots: { index: false, follow: false },
};

const DEFAULT_DOC = "doc_demo";

const HEADING_STYLE: CSSProperties = { fontFamily: "var(--ff-font-heading)" };

function BrandRow() {
  return (
    <Link href="/" aria-label="FormForge home" className="inline-flex shrink-0 items-center gap-2 no-underline">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{
          background: "var(--ff-primary)",
          color: "var(--ff-primary-fg)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
      </span>
      <span className="text-[1.0625rem] font-semibold tracking-tight text-[var(--ff-fg)]" style={HEADING_STYLE}>
        FormForge
      </span>
    </Link>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-1 font-mono text-[13px] text-[var(--ff-fg)]">
      {children}
    </code>
  );
}

// Framed preview well: white card, 1px hairline, print-like shadow — the
// embed frame inside stays document-themed (the loader owns its canvas).
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4 shadow-[var(--ff-shadow-md)]">
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ff-panel mt-10 space-y-3 p-5">
      <h2 className="flex items-center gap-3 text-base font-semibold tracking-tight text-[var(--ff-fg)]" style={HEADING_STYLE}>
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--ff-accent)" }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function EmbedDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const { doc } = await searchParams;
  const docId = doc && doc.trim().length > 0 ? doc.trim() : DEFAULT_DOC;

  return (
    <div className="min-h-screen bg-[var(--ff-bg)] text-[var(--ff-fg)]">
      <main className="mx-auto w-full max-w-4xl px-6 py-12">
        <div className="flex justify-center">
          <BrandRow />
        </div>

        <header className="mt-12 text-center">
          <span className={BADGE_ACCENT}>Embed loader QA</span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]" style={HEADING_STYLE}>
            Embed loader demo
          </h1>
          <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-[var(--ff-muted)]">
            This page loads <Chip>/api/public/embed/embed.js</Chip> and
            mounts the three modes exactly like a third-party site would. Document:{" "}
            <Chip>{docId}</Chip> — change it
            with <Chip>?doc=doc_xxxxxxxx</Chip>. Watch the
            frames auto-resize as content changes.
          </p>
        </header>

        <Panel title="1 · Inline (standard div)">
          <p className="text-sm leading-relaxed text-[var(--ff-muted)]">
            The frame below is placed inline and auto-grows with its content.
          </p>
          <Frame>
            <div data-formforge-embed={docId} data-formforge-mode="inline" data-formforge-label="FormForge form" />
          </Frame>
        </Panel>

        <Panel title="2 · Popup">
          <p className="text-sm leading-relaxed text-[var(--ff-muted)]">
            Loader injects the trigger button; the form opens in a centered overlay (Esc / backdrop closes).
          </p>
          <Frame>
            <div data-formforge-embed={docId} data-formforge-mode="popup" data-formforge-label="Give feedback" />
          </Frame>
        </Panel>

        <Panel title="3 · Side tab">
          <p className="text-sm leading-relaxed text-[var(--ff-muted)]">
            A tab pinned to the right edge of the viewport; the panel slides out.
          </p>
          <div className="h-2" data-formforge-embed={docId} data-formforge-mode="side-tab" data-formforge-label="Feedback" />
        </Panel>

        <p className="mt-10 text-sm text-[var(--ff-muted)]">
          Full docs: <Link className="font-medium text-[var(--ff-fg)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--ff-primary-2)]" href="/embed">/embed</Link>.
        </p>

        {/* The real loader, loaded the way a host page loads it. data-formforge-doc
            is intentionally absent: the three divs above are div-driven embeds. */}
        <Script src="/api/public/embed/embed.js" strategy="afterInteractive" />
      </main>
    </div>
  );
}
