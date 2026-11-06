// Embed docs page: /embed (issue #22 — "public docs page for embed code").
// Server component; the snippet URLs are rendered with the live request origin
// so copy-paste works without a build-time env var. No client JS.
//
// NOTE (route precedence): this static route does not collide with the dynamic
// /embed/[docId] frame — Next.js resolves static segments first.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";

import { EMBED_LOADER_VERSION } from "../api/public/embed/embed.js/loader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Embed a FormForge document",
  description: "Embed any published FormForge document on your site: standard div, popup, side tab or a plain iframe.",
};

async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

const LOADER_PATH = "/api/public/embed/embed.js";

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-[13px] leading-relaxed text-slate-100">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default async function EmbedDocsPage() {
  const origin = await appOrigin();
  const loaderUrl = `${origin}${LOADER_PATH}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 text-slate-600">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Public docs</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Embed a FormForge document</h1>
        <p className="mt-3 leading-relaxed">
          Publish a document, then paste one script tag into any page. The loader (v{EMBED_LOADER_VERSION}) injects the
          frame, auto-resizes its height, and forwards completion events. No build step, no dependencies, works on plain
          HTML.
        </p>
      </header>

      <Section title="Inline — the standard div">
        <p className="mt-2 text-sm leading-relaxed">
          The frame renders exactly where the script sits and grows with its content.
        </p>
        <Code>{`<script\n  src="${loaderUrl}"\n  data-formforge-doc="doc_xxxxxxxx"\n  async\n></script>`}</Code>
      </Section>

      <Section title="Popup">
        <p className="mt-2 text-sm leading-relaxed">
          Renders a button; the form opens in a centered overlay. Close with the button, backdrop click or{" "}
          <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-xs">Esc</kbd>.
        </p>
        <Code>{`<script\n  src="${loaderUrl}"\n  data-formforge-doc="doc_xxxxxxxx"\n  data-formforge-mode="popup"\n  data-formforge-label="Give feedback"\n  async\n></script>`}</Code>
      </Section>

      <Section title="Side tab">
        <p className="mt-2 text-sm leading-relaxed">
          A tab pinned to the right edge of the viewport; the form slides out from the side.
        </p>
        <Code>{`<script\n  src="${loaderUrl}"\n  data-formforge-doc="doc_xxxxxxxx"\n  data-formforge-mode="side-tab"\n  data-formforge-label="Feedback"\n  async\n></script>`}</Code>
      </Section>

      <Section title="Multiple embeds / config on the div">
        <p className="mt-2 text-sm leading-relaxed">
          Put the configuration on <code className="rounded bg-slate-100 px-1 text-[13px]">div</code> elements instead
          and load the script once — <code className="rounded bg-slate-100 px-1 text-[13px]">data-formforge-mode</code>{" "}
          also accepts the aliases <code className="rounded bg-slate-100 px-1 text-[13px]">div</code> and{" "}
          <code className="rounded bg-slate-100 px-1 text-[13px]">full-page</code> for <em>inline</em>.
        </p>
        <Code>{`<div data-formforge-embed="doc_aaa" data-formforge-mode="inline"></div>\n<div data-formforge-embed="doc_bbb" data-formforge-mode="popup" data-formforge-label="Open"></div>\n<script src="${loaderUrl}" async></script>`}</Code>
      </Section>

      <Section title="Plain iframe (no auto-resize)">
        <p className="mt-2 text-sm leading-relaxed">
          If you cannot run scripts, use the frame URL directly. It renders the published snapshot read-only; the page
          shows a graceful fallback while nothing is published.
        </p>
        <Code>{`<iframe\n  src="${origin}/embed/doc_xxxxxxxx?mode=inline"\n  style="width:100%;height:600px;border:0"\n  title="FormForge form"\n></iframe>`}</Code>
      </Section>

      <Section title="Attributes">
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Attribute</th>
                <th className="px-4 py-2 font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr><td className="px-4 py-2 font-mono text-[13px]">data-formforge-doc</td><td className="px-4 py-2">Document id to embed (script tag) — or set <code className="font-mono text-[13px]">data-formforge-embed</code> on a div</td></tr>
              <tr><td className="px-4 py-2 font-mono text-[13px]">data-formforge-mode</td><td className="px-4 py-2"><code className="font-mono text-[13px]">inline</code> (default) · <code className="font-mono text-[13px]">popup</code> · <code className="font-mono text-[13px]">side-tab</code></td></tr>
              <tr><td className="px-4 py-2 font-mono text-[13px]">data-formforge-label</td><td className="px-4 py-2">Trigger / tab label; also the iframe title</td></tr>
              <tr><td className="px-4 py-2 font-mono text-[13px]">data-formforge-origin</td><td className="px-4 py-2">Override the FormForge origin (defaults to the loader URL origin)</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="postMessage API (spec §10.2)">
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Message</th>
                <th className="px-4 py-2 font-semibold">Direction</th>
                <th className="px-4 py-2 font-semibold">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr><td className="px-4 py-2 font-mono text-[13px]">ff:ready</td><td className="px-4 py-2">frame → host</td><td className="px-4 py-2">—</td></tr>
              <tr><td className="px-4 py-2 font-mono text-[13px]">ff:height</td><td className="px-4 py-2">frame → host</td><td className="px-4 py-2"><code className="font-mono text-[13px]">{"{ value: number }"}</code> content height in px</td></tr>
              <tr><td className="px-4 py-2 font-mono text-[13px]">ff:complete</td><td className="px-4 py-2">frame → host</td><td className="px-4 py-2"><code className="font-mono text-[13px]">{"{ submissionToken }"}</code></td></tr>
              <tr><td className="px-4 py-2 font-mono text-[13px]">ff:request-height</td><td className="px-4 py-2">host → frame</td><td className="px-4 py-2">ask the frame to re-measure (also sent on window resize)</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm leading-relaxed">
          The loader only accepts messages from its own iframes whose origin matches the FormForge origin, so other
          scripts on the host page cannot spoof heights. For programmatic use, the container and{" "}
          <code className="rounded bg-slate-100 px-1 text-[13px]">window</code> receive bubbling{" "}
          <code className="rounded bg-slate-100 px-1 text-[13px]">CustomEvent</code>s:
        </p>
        <Code>{`document.addEventListener("formforge:complete", function (event) {\n  var detail = event.detail; // { docId, mode, submissionToken }\n  console.log("submission finished", detail);\n});`}</Code>
        <p className="mt-3 text-sm leading-relaxed">
          <code className="rounded bg-slate-100 px-1 text-[13px]">window.FormForgeEmbed</code> exposes{" "}
          <code className="rounded bg-slate-100 px-1 text-[13px]">{"{ version, records, scan() }"}</code> — call{" "}
          <code className="rounded bg-slate-100 px-1 text-[13px]">scan()</code> after injecting markup dynamically.
        </p>
      </Section>

      <p className="mt-12 border-t border-slate-200 pt-6 text-sm">
        See all three modes live on the{" "}
        <a className="font-medium text-slate-900 underline underline-offset-4" href="/embed/demo">
          embed demo page
        </a>
        .
      </p>
    </main>
  );
}
