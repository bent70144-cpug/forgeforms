"use client";

// Builder flow preview (spec §14.1.4 / M5 acceptance): walks the draft through
// the SAME T13 engine package the runtime uses and shows the step-by-step
// path + final ending. Also lists blocking lint errors (dangling goto …)
// exactly as publish will gate on them.

import { useMemo, useState } from "react";
import type { DocumentBody } from "@/lib/bridge";
import { logicLintErrors } from "@/lib/logic/graph";
import { sampleAnswers, simulateFlow } from "@/lib/logic/preview";
import { questionBlocks } from "@/lib/logic/graph";

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
    for (const ending of body.endings ?? []) map.set(`end:${ending.id}`, `🏁 ${ending.title}`);
    return map;
  }, [body.blocks, body.endings]);

  return (
    <section
      className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4"
      data-testid="flow-preview"
    >
      <div className="text-xs font-semibold text-[var(--ff-muted)]">Preview flow (engine: @formforge/core/logic)</div>

      {lintErrors.length > 0 && (
        <ul
          className="mt-2 rounded-md bg-red-50 p-2 text-[11px] leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-300"
          data-testid="lint-errors"
        >
          {lintErrors.map((error, i) => (
            <li key={i}>
              {error.ruleId ? `Rule "${error.ruleId}"` : error.blockId ? `Block "${error.blockId}"` : "Logic"}
              {": "}
              {error.message}
            </li>
          ))}
        </ul>
      )}

      {questions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {questions.slice(0, 6).map((q) => (
            <label key={q.id} className="flex items-center gap-1.5 text-[11px] text-[var(--ff-muted)]">
              {(typeof q.props["label"] === "string" && q.props["label"]) || q.id}
              {q.kind === "nps" || q.kind === "rating" || q.kind === "number" ? (
                <input
                  type="number"
                  className="w-16 rounded-md border border-[var(--ff-border)] bg-transparent px-1.5 py-0.5 text-xs tabular-nums text-[var(--ff-fg)]"
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
                  className="w-24 rounded-md border border-[var(--ff-border)] bg-transparent px-1.5 py-0.5 text-xs text-[var(--ff-fg)]"
                  aria-label={`Preview answer for ${q.id}`}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [q.id]: e.target.value || undefined }))}
                />
              )}
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--ff-muted)]">
            hidden
            <input
              className="w-28 rounded-md border border-[var(--ff-border)] bg-transparent px-1.5 py-0.5 font-mono text-xs text-[var(--ff-fg)]"
              aria-label="Hidden fields JSON"
              value={hiddenJson}
              onChange={(e) => setHiddenJson(e.target.value)}
            />
          </label>
        </div>
      )}

      <ol className="mt-3 space-y-1" data-testid="preview-path">
        {simulation.steps.map((step, i) => (
          <li key={`${step.blockId}-${i}`} className="text-xs text-[var(--ff-muted)]">
            <span className="font-medium text-[var(--ff-fg)]">{nodeById.get(step.blockId) ?? step.blockId}</span>
            {" → "}
            <span className="text-[var(--ff-primary)]">{nodeById.get(step.next) ?? step.next}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 text-xs">
        {simulation.ending !== null ? (
          <span
            className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
            data-testid="preview-ending"
          >
            ends at {nodeById.get(simulation.ending) ?? simulation.ending}
          </span>
        ) : simulation.truncated ? (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            flow truncated (possible loop)
          </span>
        ) : (
          <span className="text-[var(--ff-muted)]">add a question to preview the flow</span>
        )}
      </div>
    </section>
  );
}
