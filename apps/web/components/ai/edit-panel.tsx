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
//
// Aurora redesign: violet-tinted code-tile header, composer + glowing primary
// propose action, skeleton shimmer while proposing, and the proposal framed
// as a review card — badge header with op counts, tinted diff lines on a
// tokenized ink surface, Apply (primary, check) / Discard (ghost, x).
// Fetch/error/quota logic unchanged; onQuota stays an optional additive
// callback for the workbench header badge.
import { useId, useMemo, useState } from "react";
import type { DocumentBody } from "@formforge/core/ai";
import { summarizeOpsDiff, toBuilderOps, toGroupedApply, type GroupedApply } from "@/lib/builder/ai-apply";
import { track } from "@/lib/telemetry";
import { BADGE_ACCENT, BADGE_POSITIVE, BTN_GHOST, BTN_PRIMARY } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";

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
  /** Additive: surfaces the response quota for the workbench header badge. */
  onQuota?: (quota: EditResponse["quota"]) => void;
};

export function AiEditPanel({ document, workspaceId, onApply, onQuota }: AiEditPanelProps) {
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
      const body = payload as EditResponse;
      setProposal(body);
      setStatus("ready");
      onQuota?.(body.quota);
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
    <section aria-label="Edit with AI" className="ff-panel space-y-4 p-6">
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px]"
          style={{
            background: "color-mix(in srgb, var(--ff-primary) 14%, transparent)",
            color: "var(--ff-primary)",
          }}
        >
          <Icon name="code" size={16} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-[var(--ff-fg)]">Edit with AI</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--ff-muted)]">
            Proposals are shown as a diff first. Nothing changes until you apply them.
          </p>
        </div>
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
        />
        <button
          type="button"
          onClick={() => void propose()}
          disabled={status === "loading" || instruction.trim().length === 0}
          aria-busy={status === "loading"}
          className={`${BTN_PRIMARY} mt-1 self-start disabled:cursor-not-allowed`}
        >
          {status === "loading" ? (
            <>
              <Icon name="spinner" size={16} />
              Proposing…
            </>
          ) : (
            "Propose changes"
          )}
        </button>
      </div>

      <p aria-live="polite" className="text-sm">
        {status === "error" ? (
          <span role="alert" className="ff-banner ff-banner-error">
            {errorCode === "PLAN_LIMIT"
              ? `Monthly AI quota reached. ${error ?? ""}`
              : (error ?? "Edit failed.")}
          </span>
        ) : null}
      </p>

      {status === "loading" ? (
        // Proposal shimmer: status badge + skeleton rows (reduced-motion users
        // get the static pulse reset from globals.css).
        <div className="space-y-3 border-t border-[var(--ff-border)] pt-4">
          <span className={BADGE_ACCENT}>
            <Icon name="spinner" size={12} />
            Analyzing document…
          </span>
          <div className="ff-skeleton" style={{ height: "5.5rem" }} />
        </div>
      ) : null}

      {proposal ? (
        <div className="space-y-3 border-t border-[var(--ff-border)] pt-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={BADGE_ACCENT}>
              <Icon name="list" size={12} />
              Proposal
            </span>
            <span className="min-w-0 text-sm font-medium text-[var(--ff-fg)]">
              {proposal.summary}
            </span>
            <span className="ml-auto font-mono text-xs tabular-nums text-[var(--ff-muted)]">
              {proposal.ops.length} op{proposal.ops.length === 1 ? "" : "s"}
            </span>
          </div>
          {/* §11 diff list: counts summary + one line per proposed op, with
              Apply (grouped handoff) / Discard (clears). */}
          <p aria-label="Change summary" className="text-xs tabular-nums text-[var(--ff-muted)]">
            <span className="text-[var(--ff-success)]">{diffSummary.added} added</span>
            {" · "}
            <span className="text-[var(--ff-primary)]">{diffSummary.changed} changed</span>
            {" · "}
            <span className="text-[var(--ff-danger)]">{diffSummary.removed} removed</span>
            {" · "}
            {diffSummary.moved} moved · {diffSummary.other} other
          </p>
          <ul
            aria-label="Proposed changes"
            className="max-h-64 space-y-1 overflow-auto rounded-[10px] border p-3 font-mono text-xs leading-relaxed"
            style={{
              borderColor: "var(--ff-border)",
              background: "color-mix(in srgb, var(--ff-bg) 55%, var(--ff-bg-2))",
            }}
          >
            {(diffSummary.lines.length > 0 ? diffSummary.lines : proposal.diff).map(
              (line, index) => (
                <li
                  key={index}
                  className={
                    line.startsWith("+")
                      ? "text-[var(--ff-success)]"
                      : line.startsWith("−") || line.startsWith("-")
                        ? "text-[var(--ff-danger)]"
                        : "text-[var(--ff-fg)]"
                  }
                >
                  {line}
                </li>
              ),
            )}
          </ul>
          {applied ? (
            <span className={BADGE_POSITIVE}>
              <Icon name="checkCircle" size={12} />
              Ops handed to the editor as one undoable group.
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={apply} className={BTN_PRIMARY}>
                <Icon name="check" size={16} />
                Apply ops
              </button>
              <button type="button" onClick={discard} className={BTN_GHOST}>
                <Icon name="x" size={14} />
                Discard
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
