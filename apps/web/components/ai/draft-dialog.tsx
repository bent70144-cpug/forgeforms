"use client";

// AI draft dialog (spec §14/§15 M8): prompt → generated DocumentBody preview
// → "insert into document" handoff. The builder (T05) supplies onInsert;
// until then the standalone /d/[docId]/ai page wires it to a local hold.
//
// Aurora redesign: gradient spark-tile header, static suggestion chips (local
// presentation only — they fill the composer, nothing is fetched), the glass
// composer textarea with its violet focus ring, a full-width glowing primary
// CTA, skeleton shimmer + "Generating" badge while the request is in flight,
// and the draft rendered in the BodyPreview document frame with accept
// (primary) / regenerate (ghost) actions. Fetch/error/quota logic unchanged;
// onQuota is an optional additive callback for the workbench header badge.
import { useId, useState } from "react";
import type { DocumentBody, DocumentType } from "@formforge/core/ai";
import { BADGE_ACCENT, BADGE_MUTED, BTN_GHOST, BTN_GHOST_SM, BTN_PRIMARY, INPUT } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { BodyPreview } from "./body-preview";

type DraftResponse = {
  body: DocumentBody;
  attempts: number;
  quota: { plan: string; used: number; limit: number; period: string };
};

type ApiError = { error: { code: string; message: string; details?: unknown } };

const DOCUMENT_TYPES: DocumentType[] = ["form", "page", "portfolio"];

/** Composer starters — static data; chips only fill the textarea (no fetching). */
const SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: "NPS feedback form", prompt: "A two-question customer feedback form with an NPS rating" },
  { label: "Event RSVP", prompt: "An event RSVP form collecting name, email and headcount" },
  { label: "Portfolio page", prompt: "A portfolio page with a hero, project gallery and contact links" },
  { label: "Project brief", prompt: "A project brief page with a file-upload section for assets" },
];

export type AiDraftDialogProps = {
  documentType?: DocumentType;
  /** INTEGRATION-DEBT (T01): session provides this; header stopgap until then. */
  workspaceId?: string;
  /** Handoff point: builder applies the draft (replace blocks / new document). */
  onInsert?: (body: DocumentBody) => void;
  /** Additive: surfaces the response quota for the workbench header badge. */
  onQuota?: (quota: DraftResponse["quota"]) => void;
  onClose?: () => void;
};

export function AiDraftDialog({
  documentType: initialType = "form",
  workspaceId,
  onInsert,
  onQuota,
  onClose,
}: AiDraftDialogProps) {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>(initialType);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setStatus("loading");
    setError(null);
    setErrorCode(null);
    try {
      const response = await fetch("/api/v1/ai/draft", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        },
        body: JSON.stringify({ prompt, documentType }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = payload as ApiError;
        setErrorCode(apiError.error?.code ?? "INTERNAL");
        setError(apiError.error?.message ?? "The AI draft failed. Try again.");
        setStatus("error");
        return;
      }
      const body = payload as DraftResponse;
      setDraft(body);
      setStatus("ready");
      onQuota?.(body.quota);
    } catch {
      setErrorCode("NETWORK");
      setError("Could not reach the AI draft endpoint.");
      setStatus("error");
    }
  }

  const quotaLabel =
    draft?.quota != null
      ? `Used ${draft.quota.used}/${draft.quota.limit} this month (${draft.quota.period})`
      : null;

  return (
    <section aria-label="AI draft" className="ff-panel space-y-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px]"
            style={{ background: "var(--ff-grad)", boxShadow: "var(--ff-glow)", color: "#ffffff" }}
          >
            <Icon name="sparkles" size={16} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--ff-fg)]">Generate draft</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-[var(--ff-muted)]">
              Describe the document — review the generated body before it is inserted.
            </p>
          </div>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className={BTN_GHOST_SM}>
            Close
          </button>
        ) : null}
      </header>

      <div className="ff-field">
        <label htmlFor={promptId}>Describe what to build</label>
        <textarea
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="e.g. A two-question customer feedback form with an NPS rating"
          style={{ minHeight: "7rem" }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--ff-muted)]">Try:</span>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => setPrompt(suggestion.prompt)}
              className="ff-chip cursor-pointer transition-colors hover:border-[var(--ff-border-strong)]"
            >
              <Icon name="sparkles" size={12} className="shrink-0 text-[var(--ff-muted)]" />
              {suggestion.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${promptId}-type`} className="text-sm text-[var(--ff-fg)]">
          Type
        </label>
        <span className="relative inline-flex">
          <select
            id={`${promptId}-type`}
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value as DocumentType)}
            className={`${INPUT} appearance-none`}
            // Inline style: unlayered .ff-input beats padding/width utilities.
            style={{ width: "auto", padding: "0.375rem 2rem 0.375rem 0.75rem" }}
          >
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ff-muted)]"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M5.23 7.47a.75.75 0 0 1 1.06 0L10 11.19l3.71-3.72a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.23 8.53a.75.75 0 0 1 0-1.06Z"
            />
          </svg>
        </span>
      </div>

      <button
        type="button"
        onClick={() => void generate()}
        disabled={status === "loading" || prompt.trim().length === 0}
        aria-busy={status === "loading"}
        className={`${BTN_PRIMARY} w-full disabled:cursor-not-allowed`}
      >
        {status === "loading" ? (
          <>
            <Icon name="spinner" size={16} />
            Drafting…
          </>
        ) : (
          <>
            <Icon name="sparkles" size={16} />
            Generate draft
          </>
        )}
      </button>

      <p aria-live="polite" className="text-sm">
        {status === "error" ? (
          <span role="alert" className="ff-banner ff-banner-error">
            {errorCode === "PLAN_LIMIT"
              ? `Monthly AI quota reached. ${error ?? ""}`
              : (error ?? "Draft failed.")}
          </span>
        ) : null}
        {quotaLabel ? (
          <span className={`${BADGE_MUTED} mt-2 font-mono tabular-nums`}>
            <Icon name="sparkles" size={12} />
            {quotaLabel}
          </span>
        ) : null}
      </p>

      {status === "loading" && !draft ? (
        // First-generation shimmer: status badge + skeleton rows (reduced-motion
        // users get the static pulse reset from globals.css).
        <div className="space-y-3 border-t border-[var(--ff-border)] pt-4">
          <span className={BADGE_ACCENT}>
            <Icon name="spinner" size={12} />
            Generating draft…
          </span>
          <div className="ff-skeleton" style={{ height: "2.75rem" }} />
          <div className="ff-skeleton" style={{ height: "2.75rem" }} />
          <div className="ff-skeleton" style={{ height: "6rem" }} />
        </div>
      ) : null}

      {draft ? (
        <div className="space-y-3 border-t border-[var(--ff-border)] pt-4">
          <BodyPreview body={draft.body} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onInsert?.(draft.body)} className={BTN_PRIMARY}>
              <Icon name="check" size={16} />
              Insert into document
            </button>
            <button type="button" onClick={() => void generate()} className={BTN_GHOST}>
              <Icon name="refresh" size={14} />
              Regenerate
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
