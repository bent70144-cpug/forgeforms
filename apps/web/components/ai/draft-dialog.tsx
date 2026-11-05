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
      className="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Draft with AI</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        ) : null}
      </header>

      <div className="space-y-2">
        <label htmlFor={promptId} className="block text-sm font-medium">
          Describe what to build
        </label>
        <textarea
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="e.g. A two-question customer feedback form with an NPS rating"
          className="w-full rounded border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        <div className="flex items-center gap-2">
          <label htmlFor={`${promptId}-type`} className="text-sm">
            Type
          </label>
          <select
            id={`${promptId}-type`}
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value as DocumentType)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          >
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={status === "loading" || prompt.trim().length === 0}
            className="ml-auto rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {status === "loading" ? "Drafting…" : "Generate draft"}
          </button>
        </div>
      </div>

      <p aria-live="polite" className="text-sm">
        {status === "error" ? (
          <span role="alert" className="text-red-600 dark:text-red-400">
            {errorCode === "PLAN_LIMIT"
              ? `Monthly AI quota reached. ${error ?? ""}`
              : (error ?? "Draft failed.")}
          </span>
        ) : null}
        {quotaLabel}
      </p>

      {draft ? (
        <div className="space-y-3">
          <BodyPreview body={draft.body} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onInsert?.(draft.body)}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Insert into document
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              Regenerate
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
