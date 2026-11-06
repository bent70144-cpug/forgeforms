"use client";

// AI draft dialog (spec §14/§15 M8): prompt → generated DocumentBody preview
// → "insert into document" handoff. The builder (T05) supplies onInsert;
// until then the standalone /d/[docId]/ai page wires it to a local hold.
import { useId, useState } from "react";
import type { DocumentBody, DocumentType } from "@formforge/core/ai";
import { BodyPreview } from "./body-preview";

type DraftResponse = {
  body: DocumentBody;
  attempts: number;
  quota: { plan: string; used: number; limit: number; period: string };
};

type ApiError = { error: { code: string; message: string; details?: unknown } };

const DOCUMENT_TYPES: DocumentType[] = ["form", "page", "portfolio"];

export type AiDraftDialogProps = {
  documentType?: DocumentType;
  /** INTEGRATION-DEBT (T01): session provides this; header stopgap until then. */
  workspaceId?: string;
  /** Handoff point: builder applies the draft (replace blocks / new document). */
  onInsert?: (body: DocumentBody) => void;
  onClose?: () => void;
};

export function AiDraftDialog({
  documentType: initialType = "form",
  workspaceId,
  onInsert,
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
    <section
      aria-label="AI draft"
      className="space-y-4 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-6"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--ff-fg)]">Draft with AI</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-fg)]"
          >
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
          className="w-full rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 py-2 text-sm leading-relaxed text-[var(--ff-fg)] placeholder:text-[var(--ff-muted)] focus-visible:border-[var(--ff-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ff-primary)]"
        />
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
            className="appearance-none rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] py-1.5 pl-3 pr-8 text-sm text-[var(--ff-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ff-primary)]"
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
        <button
          type="button"
          onClick={() => void generate()}
          disabled={status === "loading" || prompt.trim().length === 0}
          className="ff-button ff-button-primary ml-auto text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Drafting…" : "Generate draft"}
        </button>
      </div>

      <p aria-live="polite" className="text-sm">
        {status === "error" ? (
          <span role="alert" className="text-red-600 dark:text-red-400">
            {errorCode === "PLAN_LIMIT"
              ? `Monthly AI quota reached. ${error ?? ""}`
              : (error ?? "Draft failed.")}
          </span>
        ) : null}
        {quotaLabel ? (
          <span className="ml-2 tabular-nums text-[var(--ff-muted)]">{quotaLabel}</span>
        ) : null}
      </p>

      {draft ? (
        <div className="space-y-3">
          <BodyPreview body={draft.body} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onInsert?.(draft.body)}
              className="ff-button ff-button-primary text-sm"
            >
              Insert into document
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              className="ff-button ff-button-ghost text-sm"
            >
              Regenerate
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
