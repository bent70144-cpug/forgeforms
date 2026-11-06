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
import type { ReactNode } from "react";

import HarnessClient from "./harness-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "form-embed postMessage harness — FormForge",
  robots: { index: false, follow: false },
};

const DEFAULT_DOC = "doc_demo";

function Chip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-1 font-mono text-[13px] text-[var(--ff-fg)]">
      {children}
    </code>
  );
}

export default async function FormEmbedHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const { doc } = await searchParams;
  const docId = doc && doc.trim().length > 0 ? doc.trim() : DEFAULT_DOC;

  return (
    <div className="min-h-screen bg-[var(--ff-bg)] text-[var(--ff-fg)]">
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ff-fg)]">
          form-embed postMessage harness
        </h1>
        <p className="mt-3 leading-relaxed text-[var(--ff-muted)]">
          Exercises the parent side of the <Chip>ff:height</Chip> / <Chip>ff:complete</Chip> protocol
          (spec §10.2): the <Chip>form-embed</Chip> block listens to its child frame (
          <Chip>/embed/{docId}</Chip>), resizes to <Chip>ff:height</Chip>, and forwards{" "}
          <Chip>ff:complete</Chip> upward when the page itself is embedded. Document:{" "}
          <Chip>{docId}</Chip> — change it with{" "}
          <Chip>?doc=doc_xxxxxxxx</Chip>.
        </p>

        <HarnessClient docId={docId} />

        <p className="mt-8 border-t border-[var(--ff-border)] pt-6 text-sm leading-relaxed text-[var(--ff-muted)]">
          The protocol guards are unit-tested in <Chip>packages/blocks</Chip>{" "}
          (shared/embed-protocol.test.ts) — this page is the live smoke test.
        </p>
      </main>
    </div>
  );
}
