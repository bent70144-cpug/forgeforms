"use client";

// Standalone AI workbench for /d/[docId]/ai. The builder page (T05) will
// instead embed AiDraftDialog + AiEditPanel directly in the three panes so
// drafts/ops flow into optimistic autosave; this page keeps the feature
// reachable end-to-end until that integration lands.
//
// Meridian redesign: quiet terracotta spark tile (the AI signal — no glow, no
// gradient text) with a terracotta "AI workbench" kicker chip and a Sora
// headline, closed by a plain 1px hairline. The compose zone (draft + edit
// panels) and the current-document zone are separated by hairlines instead of
// nested chrome. All handoff logic, notices and state flow unchanged (quota
// callbacks are additive, optional).
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

/** The workbench's signature mark: terracotta spark on a quiet card tile. */
function SparkMark() {
  return (
    <span
      aria-hidden="true"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]"
      style={{
        background: "color-mix(in srgb, var(--ff-accent) 10%, var(--ff-card))",
        border: "1px solid color-mix(in srgb, var(--ff-accent) 25%, transparent)",
        color: "var(--ff-accent)",
      }}
    >
      <Icon name="sparkles" size={20} />
    </span>
  );
}

export function AiWorkbench({ docId: _docId }: { docId: string }) {
  const [document, setDocument] = useState<DocumentBody>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <SparkMark />
            <div className="min-w-0">
              <span className={`${BADGE_ACCENT} font-mono uppercase tracking-[0.14em]`}>
                <Icon name="sparkles" size={12} />
                AI workbench
              </span>
              <h1
                className="mt-3 text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--ff-fg)]"
                style={{ fontFamily: "var(--ff-font-heading)" }}
              >
                Describe it — AI drafts it
              </h1>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--ff-muted)]">
                Draft and revise document content with AI — review every change before applying.
              </p>
            </div>
          </div>
          {quota ? (
            <span className={`${BADGE_ACCENT} font-mono tabular-nums`}>
              <Icon name="sparkles" size={12} />
              Used {quota.used}/{quota.limit} · {quota.period}
            </span>
          ) : null}
        </div>
        {/* Plain hairline closing the header block. */}
        <div
          aria-hidden="true"
          className="mt-6 h-px w-full"
          style={{ background: "var(--ff-border)" }}
        />
      </header>

      {notice ? (
        <p role="status" aria-live="polite" className={BANNER_SUCCESS}>
          {notice}
        </p>
      ) : null}

      {/* Compose zone: prompt composer and edit proposal, split by a hairline. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]">
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

        <div
          aria-hidden="true"
          className="h-px w-full lg:h-auto lg:w-px lg:self-stretch"
          style={{ background: "var(--ff-border)" }}
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

      {/* Preview zone: the current document, fenced off by a hairline above. */}
      <div
        aria-hidden="true"
        className="h-px w-full"
        style={{ background: "var(--ff-border)" }}
      />

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
        <h2
          className="text-sm font-semibold tracking-[-0.01em] text-[var(--ff-fg)]"
          style={{ fontFamily: "var(--ff-font-heading)" }}
        >
          Current document
        </h2>
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
