"use client";

// Edit-with-AI panel: instruction → proposed ops with a reviewable diff →
// explicit "Apply" (issue #27: AI ops are never applied without user
// confirmation). onApply is the handoff point to the builder autosave (T05),
// which replays the ops through the normal documents PATCH flow.
import { useId, useState } from "react";
import type { DocumentBody } from "@formforge/core/ai";

type EditResponse = {
  summary: string;
  ops: Array<Record<string, unknown>>;
  diff: string[];
  attempts: number;
  quota: { plan: string; used: number; limit: number; period: string };
};

type ApiError = { error: { code: string; message: string; details?: unknown } };

export type AiEditPanelProps = {
  document: DocumentBody;
  /** INTEGRATION-DEBT (T01): session provides this; header stopgap until then. */
  workspaceId?: string;
  /** Handoff point: builder applies the confirmed ops via documents PATCH. */
  onApply?: (ops: EditResponse["ops"]) => void;
};

export function AiEditPanel({ document, workspaceId, onApply }: AiEditPanelProps) {
  const instructionId = useId();
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [proposal, setProposal] = useState<EditResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  async function propose(): Promise<void> {
    setStatus("loading");
    setError(null);
    setErrorCode(null);
    setProposal(null);
    setApplied(false);
    try {
      const response = await fetch("/api/v1/ai/edit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        },
        body: JSON.stringify({ instruction, document }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = payload as ApiError;
        setErrorCode(apiError.error?.code ?? "INTERNAL");
        setError(apiError.error?.message ?? "The AI edit failed. Try again.");
        setStatus("error");
        return;
      }
      setProposal(payload as EditResponse);
      setStatus("ready");
    } catch {
      setErrorCode("NETWORK");
      setError("Could not reach the AI edit endpoint.");
      setStatus("error");
    }
  }

  return (
    <section
      aria-label="Edit with AI"
      className="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700"
    >
      <header>
        <h2 className="text-base font-semibold">Edit with AI</h2>
        <p className="text-sm opacity-70">
          Proposals are shown as a diff first. Nothing changes until you apply them.
        </p>
      </header>

      <div className="space-y-2">
        <label htmlFor={instructionId} className="block text-sm font-medium">
          What should change?
        </label>
        <textarea
          id={instructionId}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="e.g. Make the email question required and move it first"
          className="w-full rounded border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={() => void propose()}
          disabled={status === "loading" || instruction.trim().length === 0}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {status === "loading" ? "Proposing…" : "Propose changes"}
        </button>
      </div>

      <p aria-live="polite" className="text-sm">
        {status === "error" ? (
          <span role="alert" className="text-red-600 dark:text-red-400">
            {errorCode === "PLAN_LIMIT"
              ? `Monthly AI quota reached. ${error ?? ""}`
              : (error ?? "Edit failed.")}
          </span>
        ) : null}
      </p>

      {proposal ? (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{proposal.summary}</span>{" "}
            <span className="opacity-70">
              ({proposal.ops.length} op{proposal.ops.length === 1 ? "" : "s"})
            </span>
          </p>
          <ul
            aria-label="Proposed changes"
            className="space-y-1 rounded bg-neutral-50 p-3 font-mono text-xs dark:bg-neutral-800"
          >
            {proposal.diff.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          {applied ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              Ops handed to the editor.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                onApply?.(proposal.ops);
                setApplied(true);
              }}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Apply ops
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
