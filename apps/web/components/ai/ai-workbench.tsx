"use client";

// Standalone AI workbench for /d/[docId]/ai. The builder page (T05) will
// instead embed AiDraftDialog + AiEditPanel directly in the three panes so
// drafts/ops flow into optimistic autosave; this page keeps the feature
// reachable end-to-end until that integration lands.
import { useState } from "react";
import type { DocumentBody } from "@formforge/core/ai";
import { AiDraftDialog } from "./draft-dialog";
import { AiEditPanel } from "./edit-panel";

// Schema-valid empty form — the workbench's editable stand-in document.
const EMPTY_FORM: DocumentBody = {
  schemaVersion: 1,
  type: "form",
  theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
  settings: {
    seo: {},
    locale: "en",
    progressBar: true,
    autoAdvance: true,
    showBranding: true,
    captcha: false,
    notifyEmails: [],
  },
  blocks: [],
  endings: [],
  logic: { rules: [] },
};

export function AiWorkbench({ docId }: { docId: string }) {
  const [document, setDocument] = useState<DocumentBody>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">AI for document {docId}</h1>
        <p className="text-sm opacity-70">
          Draft a document from a prompt, or propose edits to the current one.
        </p>
      </header>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
        >
          {notice}
        </p>
      ) : null}

      <AiDraftDialog
        documentType={document.type}
        onInsert={(body) => {
          // INTEGRATION-DEBT (T05): the builder replaces its local document /
          // enqueues ops through autosave here. Standalone page swaps locally.
          setDocument(body);
          setNotice("Draft loaded below as the current document.");
        }}
      />

      <AiEditPanel
        document={document}
        onApply={(ops) => {
          // INTEGRATION-DEBT (T05): replay ops via PATCH /api/v1/documents/:id
          // through the autosave client, then reconcile from the response.
          setNotice(
            `Handoff point: ${ops.length} confirmed op(s) will be applied by the builder (T05).`,
          );
        }}
      />

      <section aria-label="Current document" className="text-sm opacity-80">
        <h2 className="font-medium">Current document</h2>
        <p className="font-mono text-xs">
          {document.type} · {document.blocks.length} block(s) · schemaVersion{" "}
          {document.schemaVersion}
        </p>
      </section>
    </div>
  );
}
