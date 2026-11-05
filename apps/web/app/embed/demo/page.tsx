// Embed QA page: /embed/demo (issue #22 acceptance — "embed works on a plain
// HTML test page and auto-resizes height"). Loads the real loader script and
// mounts one embed per mode, the way a third-party host page would. While no
// public snapshot endpoint is deployed, frames show the graceful fallback view
// — which still exercises ff:ready / ff:height / ff:request-height end to end.
//
// QA: pass a real published doc id with ?doc=doc_xxxxxxxx to see live content.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Embed demo — FormForge",
  description: "Live demo of the FormForge embed loader: inline, popup and side tab.",
  robots: { index: false, follow: false },
};

const DEFAULT_DOC = "doc_demo";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
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
    <main className="mx-auto w-full max-w-4xl px-6 py-12 text-slate-600">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Embed loader demo</h1>
        <p className="mt-3 leading-relaxed">
          This page loads <code className="rounded bg-slate-100 px-1 text-[13px]">/api/public/embed/embed.js</code> and
          mounts the three modes exactly like a third-party site would. Document:{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-[13px] text-slate-900">{docId}</code> — change it
          with <code className="rounded bg-slate-100 px-1 font-mono text-[13px]">?doc=doc_xxxxxxxx</code>. Watch the
          frames auto-resize as content changes.
        </p>
      </header>

      <Panel title="1 · Inline (standard div)">
        <p className="mt-2 text-sm">The frame below is placed inline and auto-grows with its content.</p>
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4">
          <div data-formforge-embed={docId} data-formforge-mode="inline" data-formforge-label="FormForge form" />
        </div>
      </Panel>

      <Panel title="2 · Popup">
        <p className="mt-2 text-sm">
          Loader injects the trigger button; the form opens in a centered overlay (Esc / backdrop closes).
        </p>
        <div className="mt-4">
          <div data-formforge-embed={docId} data-formforge-mode="popup" data-formforge-label="Give feedback" />
        </div>
      </Panel>

      <Panel title="3 · Side tab">
        <p className="mt-2 text-sm">A tab pinned to the right edge of the viewport; the panel slides out.</p>
        <div className="mt-4 h-2" data-formforge-embed={docId} data-formforge-mode="side-tab" data-formforge-label="Feedback" />
      </Panel>

      <p className="mt-10 text-sm text-slate-500">
        Full docs: <a className="font-medium text-slate-900 underline underline-offset-4" href="/embed">/embed</a>.
      </p>

      {/* The real loader, loaded the way a host page loads it. data-formforge-doc
          is intentionally absent: the three divs above are div-driven embeds. */}
      <Script src="/api/public/embed/embed.js" strategy="afterInteractive" />
    </main>
  );
}
