"use client";

// Standalone AI workbench for /d/[docId]/ai. The builder page (T05) will
// instead embed AiDraftDialog + AiEditPanel directly in the three panes so
// drafts/ops flow into optimistic autosave; this page keeps the feature
// reachable end-to-end until that integration lands.
//
// Aurora redesign: gradient spark mark + "Describe it — AI drafts it"
// headline (the AI moment of the app), aurora glow wash and gradient
// hairline, quota badge, two-column Draft/Edit grid and the slim "Current
// document" meta row with mono chips. All handoff logic, notices and state
// flow unchanged (quota callbacks are additive, optional).
import { useState } from "react";
import type { DocumentBody } from "@formforge/core/ai";
import { BADGE_ACCENT, BADGE_MUTED, BANNER_SUCCESS } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
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

type Quota = { used: number; limit: number; period: string };

/** The workbench's signature mark: white spark on the violet→cyan gradient. */
function SparkMark() {
  return (
    <span
      aria-hidden="true"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]"
      style={{ background: "var(--ff-grad)", boxShadow: "var(--ff-glow)", color: "#ffffff" }}
    >
      <Icon name="sparkles" size={22} />
    </span>
  );
}

export function AiWorkbench({ docId: _docId }: { docId: string }) {
  const [document, setDocument] = useState<DocumentBody>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  return (
    <div className="space-y-6">
      <header className="relative">
        {/* Aurora wash — static decoration, safe under reduced motion. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 right-8 h-52 w-52 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--ff-primary), transparent)" }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <SparkMark />
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--ff-muted)]">
                AI workbench
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--ff-fg)]">
                Describe it —{" "}
                <span
                  style={{
                    backgroundImage: "var(--ff-grad)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  AI drafts it
                </span>
              </h1>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--ff-muted)]">
                Draft and revise document content with AI — review every change before applying.
              </p>
            </div>
          </div>
          {quota ? (
            <span className={`${BADGE_ACCENT} tabular-nums`}>
              <Icon name="sparkles" size={12} />
              Used {quota.used}/{quota.limit} · {quota.period}
            </span>
          ) : null}
        </div>
        {/* Gradient hairline closing the header block. */}
        <div
          aria-hidden="true"
          className="relative mt-6 h-px w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--ff-primary) 55%, transparent) 30%, color-mix(in srgb, var(--ff-primary-2) 55%, transparent) 72%, transparent)",
          }}
        />
      </header>

      {notice ? (
        <p role="status" aria-live="polite" className={BANNER_SUCCESS}>
          {notice}
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <AiDraftDialog
          documentType={document.type}
          onQuota={setQuota}
          onInsert={(body) => {
            // INTEGRATION-DEBT (T05): the builder replaces its local document /
            // enqueues ops through autosave here. Standalone page swaps locally.
            setDocument(body);
            setNotice("Draft loaded below as the current document.");
          }}
        />

        <AiEditPanel
          document={document}
          onQuota={setQuota}
          onApply={(ops) => {
            // INTEGRATION-DEBT (T05): replay ops via PATCH /api/v1/documents/:id
            // through the autosave client, then reconcile from the response.
            setNotice(
              `Handoff point: ${ops.length} confirmed op(s) will be applied by the builder (T05).`,
            );
          }}
        />
      </div>

      <section
        aria-label="Current document"
        className="ff-panel flex flex-wrap items-center gap-x-3 gap-y-2 p-4"
      >
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]"
          style={{
            background: "color-mix(in srgb, var(--ff-primary) 12%, transparent)",
            color: "var(--ff-primary)",
          }}
        >
          <Icon name="fileText" size={16} />
        </span>
        <h2 className="text-sm font-semibold text-[var(--ff-fg)]">Current document</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={`${BADGE_MUTED} font-mono`}>{document.type}</span>
          <span className={`${BADGE_MUTED} font-mono tabular-nums`}>
            {document.blocks.length} block{document.blocks.length === 1 ? "" : "s"}
          </span>
          <span className={`${BADGE_MUTED} font-mono tabular-nums`}>
            {document.endings.length} ending{document.endings.length === 1 ? "" : "s"}
          </span>
          <span className={`${BADGE_MUTED} font-mono tabular-nums`}>
            schemaVersion {document.schemaVersion}
          </span>
        </div>
      </section>
    </div>
  );
}
