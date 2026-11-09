"use client";

// Builder flow preview (spec §14.1.4 / M5 acceptance): walks the draft through
// the SAME T13 engine package the runtime uses and shows the step-by-step
// path + final ending. Also lists blocking lint errors (dangling goto …)
// exactly as publish will gate on them.
//
// Meridian redesign (task 10/13): the same node language as the canvas, at
// preview density — a recessed paper well for the simulated path, white
// hairline step cards with mono numerals in ultramarine circles, terracotta
// goto targets, a quiet tinted tile in the header, and no canvas controls
// (read-only). Simulation/lint logic is unchanged.

import { useMemo, useState } from "react";
import type { DocumentBody } from "@/lib/bridge";
import { BADGE_POSITIVE, BADGE_WARNING, BANNER_ERROR, CARD } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { logicLintErrors, questionBlocks } from "@/lib/logic/graph";
import { sampleAnswers, simulateFlow } from "@/lib/logic/preview";

// .ff-input defaults are unlayered CSS → width/size overrides need `!`.
const PREVIEW_INPUT = "ff-input min-h-[2.25rem]! rounded-lg! px-2! text-[13px]!";

/** Header tile — quiet ultramarine tint, matching the canvas node tiles. */
const HEADER_TILE =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--ff-primary)_22%,transparent)] bg-[color-mix(in_srgb,var(--ff-primary)_8%,var(--ff-card))] text-[var(--ff-primary)]";

/** Numbered step circle on the path rail (mono numeral, white hairline ring). */
const STEP_CIRCLE =
  "relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--ff-border-strong)] bg-[var(--ff-card)] font-mono text-[10px] font-semibold text-[var(--ff-primary)]";

/** Recessed paper well for the simulated path. */
const PATH_WELL =
  "rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg-2)] p-3";

/** One step of the path, styled as a mini node card (same language as canvas). */
const STEP_CARD =
  "min-w-0 flex-1 truncate rounded-lg border border-[var(--ff-border)] bg-[var(--ff-card)] px-2 py-1 text-xs text-[var(--ff-muted)] shadow-[var(--ff-shadow-sm)]";

export function FlowPreview({ body }: { body: DocumentBody }) {
  const questions = useMemo(() => questionBlocks(body.blocks ?? []), [body.blocks]);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [hiddenJson, setHiddenJson] = useState("{}");

  const hidden = useMemo<Record<string, unknown>>(() => {
    try {
      const parsed = JSON.parse(hiddenJson) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [hiddenJson]);

  const answers = useMemo(() => sampleAnswers(body, overrides), [body, overrides]);
  const simulation = useMemo(
    () => simulateFlow(body, answers, { hidden }),
    [body, answers, hidden],
  );
  const lintErrors = useMemo(() => logicLintErrors(body), [body]);
  const nodeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const block of body.blocks ?? []) {
      if (block && typeof block.id === "string") {
        const label = block.props["label"];
        map.set(block.id, typeof label === "string" && label !== "" ? label : block.id);
      }
    }
    for (const ending of body.endings ?? []) map.set(`end:${ending.id}`, ending.title);
    return map;
  }, [body.blocks, body.endings]);

  return (
    <section className={`${CARD} p-4`} data-testid="flow-preview" aria-label="Preview flow">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ff-fg)]">
          <span aria-hidden="true" className={HEADER_TILE}>
            <Icon name="flow" size={13} />
          </span>
          Preview
        </h2>
        <span className="font-mono text-xs text-[var(--ff-muted)]">@formforge/core/logic</span>
      </div>

      {lintErrors.length > 0 && (
        <div className={`${BANNER_ERROR} mt-3`} data-testid="lint-errors" role="alert">
          <ul className="space-y-1">
            {lintErrors.map((error, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                <span>
                  {error.ruleId ? `Rule "${error.ruleId}"` : error.blockId ? `Block "${error.blockId}"` : "Logic"}
                  {": "}
                  {error.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {questions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--ff-border)] pt-3">
          {questions.slice(0, 6).map((q) => (
            <label key={q.id} className="flex items-center gap-1.5 text-xs text-[var(--ff-muted)]">
              <span className="max-w-[10rem] truncate">
                {(typeof q.props["label"] === "string" && q.props["label"]) || q.id}
              </span>
              {q.kind === "nps" || q.kind === "rating" || q.kind === "number" ? (
                <input
                  type="number"
                  className={`${PREVIEW_INPUT} w-16! tabular-nums`}
                  aria-label={`Preview answer for ${q.id}`}
                  value={typeof overrides[q.id] === "number" ? String(overrides[q.id]) : ""}
                  onChange={(e) =>
                    setOverrides((prev) => ({
                      ...prev,
                      [q.id]: e.target.value === "" ? undefined : Number(e.target.value),
                    }))
                  }
                />
              ) : (
                <input
                  className={`${PREVIEW_INPUT} w-24!`}
                  aria-label={`Preview answer for ${q.id}`}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [q.id]: e.target.value || undefined }))}
                />
              )}
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-xs text-[var(--ff-muted)]">
            hidden
            <input
              className={`${PREVIEW_INPUT} w-28! font-mono`}
              aria-label="Hidden fields JSON"
              value={hiddenJson}
              onChange={(e) => setHiddenJson(e.target.value)}
            />
          </label>
        </div>
      )}

      {simulation.steps.length > 0 && (
        <div className={`${PATH_WELL} mt-3`}>
          <ol className="max-h-44 space-y-2.5 overflow-y-auto pr-1" data-testid="preview-path">
            {simulation.steps.map((step, i) => (
              <li key={`${step.blockId}-${i}`} className="relative flex items-center gap-2.5">
                {i < simulation.steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-2.5 left-[9.5px] top-[22px] w-px bg-[var(--ff-border-strong)]"
                  />
                )}
                <span className={STEP_CIRCLE}>{i + 1}</span>
                <span className={STEP_CARD}>
                  <span className="font-medium text-[var(--ff-fg)]">
                    {nodeById.get(step.blockId) ?? step.blockId}
                  </span>
                  {" → "}
                  <span className="text-[var(--ff-accent)]">{nodeById.get(step.next) ?? step.next}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-3 text-xs">
        {simulation.ending !== null ? (
          <span
            className={`${BADGE_POSITIVE} inline-flex items-center gap-1`}
            data-testid="preview-ending"
          >
            <Icon name="checkCircle" size={14} />
            Ends: {nodeById.get(simulation.ending) ?? simulation.ending}
          </span>
        ) : simulation.truncated ? (
          <span className={`${BADGE_WARNING} inline-flex items-center gap-1`}>
            <Icon name="alert" size={14} />
            Flow truncated (possible loop)
          </span>
        ) : (
          <span className="text-[var(--ff-muted)]">Add a question to preview the flow</span>
        )}
      </div>
    </section>
  );
}
