"use client";

// Edit-with-AI panel: instruction → proposed ops with a reviewable diff →
// explicit "Apply" (issue #27: AI ops are never applied without user
// confirmation). onApply is the handoff point to the builder autosave (T05),
// which replays the ops through the normal documents PATCH flow.
//
// B8 (spec §11): the proposal is reviewed as a diff list with Apply/Discard,
// and Apply hands off the ops as ONE undoable group — toGroupedApply bundles
// `{ops, label, group}` (`ai:<batchId>`) for the builder store's apply action
// (§11 "applying dispatches ops through the normal path, so it is one
// undoable group"). §15 telemetry: "ai_applied {opsCount}" — counts only.
import { useId, useMemo, useState } from "react";
import type { DocumentBody } from "@formforge/core/ai";
import { summarizeOpsDiff, toBuilderOps, toGroupedApply, type GroupedApply } from "@/lib/builder/ai-apply";
import { track } from "@/lib/telemetry";

type EditResponse = {
  summary: string;
  ops: Array<Record<string, unknown>>;
  diff: string[];
  attempts: number;
  quota: { plan: string; used: number; limit: number; period: string };
};

type ApiError = { error: { code: string; message: string; details?: unknown } };

/** Batch id for the `ai:<batchId>` history group (crypto-backed, offline-safe). */
export function newAiBatchId(now: () => number = Date.now): string {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  return `batch-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type AiEditPanelProps = {
  document: DocumentBody;
  /** INTEGRATION-DEBT (T01): session provides this; header stopgap until then. */
  workspaceId?: string;
  /**
   * Handoff point: builder applies the confirmed ops via documents PATCH.
   * B8: the second argument carries the §11 grouped apply bundle — dispatch
   * it as `dispatch({ type: "apply", ...grouped })` so the whole AI proposal
   * lands as ONE undoable history entry (undo label "Apply AI edits (N)").
   */
  onApply?: (ops: EditResponse["ops"], grouped?: GroupedApply) => void;
};

export function AiEditPanel({ document, workspaceId, onApply }: AiEditPanelProps) {
  const instructionId = useId();
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [proposal, setProposal] = useState<EditResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // Client-side diff summary (§11): counts + human lines derived from the
  // proposal ops (core vocabulary normalized to the builder Op union).
  const diffSummary = useMemo(
    () => summarizeOpsDiff(toBuilderOps(proposal?.ops ?? [])),
    [proposal],
  );

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

  function discard(): void {
    setProposal(null);
    setApplied(false);
    setStatus("idle");
    setError(null);
    setErrorCode(null);
  }

  function apply(): void {
    if (!proposal || applied) return;
    const builderOps = toBuilderOps(proposal.ops);
    const grouped = toGroupedApply(builderOps, newAiBatchId());
    // §15 telemetry: op count only — never labels or props.
    track("ai_applied", { opsCount: builderOps.length });
    onApply?.(proposal.ops, grouped);
    setApplied(true);
  }

  return (
    <section
      aria-label="Edit with AI"
      className="space-y-4 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-6"
    >
      <header>
        <h2 className="text-base font-semibold text-[var(--ff-fg)]">Edit with AI</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
          Proposals are shown as a diff first. Nothing changes until you apply them.
        </p>
      </header>

      <div className="ff-field">
        <label htmlFor={instructionId}>What should change?</label>
        <textarea
          id={instructionId}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="e.g. Make the email question required and move it first"
          className="w-full rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 py-2 text-sm leading-relaxed text-[var(--ff-fg)] placeholder:text-[var(--ff-muted)] focus-visible:border-[var(--ff-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ff-primary)]"
        />
        <button
          type="button"
          onClick={() => void propose()}
          disabled={status === "loading" || instruction.trim().length === 0}
          className="ff-button ff-button-primary self-start text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
          <p className="text-sm text-[var(--ff-fg)]">
            <span className="font-medium">{proposal.summary}</span>{" "}
            <span className="tabular-nums text-[var(--ff-muted)]">
              ({proposal.ops.length} op{proposal.ops.length === 1 ? "" : "s"})
            </span>
          </p>
          {/* §11 diff list: counts summary + one line per proposed op, with
              Apply (grouped handoff) / Discard (clears). */}
          <p aria-label="Change summary" className="text-xs opacity-80">
            {diffSummary.added} added · {diffSummary.changed} changed · {diffSummary.removed}{" "}
            removed · {diffSummary.moved} moved · {diffSummary.other} other
          </p>
          <ul
            aria-label="Proposed changes"
            className="space-y-1 rounded-[calc(var(--ff-radius)*0.66)] border border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] p-3 font-mono text-xs leading-relaxed text-[var(--ff-fg)]"
          >
            {diffSummary.lines.length > 0
              ? diffSummary.lines.map((line, index) => <li key={index}>{line}</li>)
              : proposal.diff.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
          {applied ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              Ops handed to the editor as one undoable group.
            </p>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={apply} className="ff-button ff-button-primary text-sm">
                Apply ops
              </button>
              <button
                type="button"
                onClick={discard}
                className="ff-button ff-button-ghost text-sm"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
