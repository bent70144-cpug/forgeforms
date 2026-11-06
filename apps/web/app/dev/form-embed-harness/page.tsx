// T21 — test harness for the form-embed postMessage loop (acceptance:
// "form-embed posts height and complete events; parent listens (test harness
// page)"). Plain-HTML explanation lives inline; the interactive part is the
// client component below.
//
// Modes:
//  - ?doc=<published doc id>  → real frames load the published document
//  - default (doc_demo)       → frames show the graceful fallback, which still
//                               posts real ff:ready / ff:height messages
import type { Metadata } from "next";

import HarnessClient from "./harness-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "form-embed postMessage harness — FormForge",
  robots: { index: false, follow: false },
};

const DEFAULT_DOC = "doc_demo";

export default async function FormEmbedHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const { doc } = await searchParams;
  const docId = doc && doc.trim().length > 0 ? doc.trim() : DEFAULT_DOC;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 text-slate-600">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        form-embed postMessage harness
      </h1>
      <p className="mt-3 leading-relaxed">
        Exercises the parent side of the <code>ff:height</code> / <code>ff:complete</code> protocol
        (spec §10.2): the <code>form-embed</code> block listens to its child frame (
        <code>/embed/{docId}</code>), resizes to <code>ff:height</code>, and forwards{" "}
        <code>ff:complete</code> upward when the page itself is embedded. Document:{" "}
        <code className="font-mono text-slate-900">{docId}</code> — change it with{" "}
        <code>?doc=doc_xxxxxxxx</code>.
      </p>

      <HarnessClient docId={docId} />

      <p className="mt-8 border-t border-slate-200 pt-6 text-sm">
        The protocol guards are unit-tested in <code>packages/blocks</code>{" "}
        (shared/embed-protocol.test.ts) — this page is the live smoke test.
      </p>
    </main>
  );
}
