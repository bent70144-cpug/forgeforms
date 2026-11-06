// Flow preview simulator (spec §14.1.4 "builder preview"): walks a draft
// document through the SAME T13 engine package the runtime uses
// (`@formforge/core/logic` — single import surface, spec §15 M5 acceptance:
// "Same engine package is used on client and server").
//
// Pure: compile() once, then evaluate() per step with the draft answers.

import { compile, evaluate } from "@formforge/core/logic";
import type { DocumentBody } from "../bridge";
import { questionBlocks } from "./graph";
import { prefillAnswers } from "./hidden";

export type FlowStep = {
  blockId: string;
  /** The committed answer used at this step (from `answers`/prefill). */
  answer: unknown;
  /** Engine verdict for this scope: next blockId or `end:<endingId>`. */
  next: string;
  variables: Record<string, unknown>;
};

export type FlowSimulation = {
  steps: FlowStep[];
  /** Final `end:<endingId>` target, or null when the walk was cut short. */
  ending: string | null;
  /** Set when the walk exceeded `maxSteps` (defensive cycle guard). */
  truncated: boolean;
};

const DEFAULT_MAX_STEPS = 100;

/**
 * Simulates the conversational flow: start → questions per the engine's
 * verdicts → ending. `answers` are raw per-block values (normalized values
 * like `{ optionId }` are handled by the engine).
 */
export function simulateFlow(
  body: DocumentBody,
  answers: Record<string, unknown>,
  opts: { hidden?: Record<string, unknown>; urlParams?: Record<string, unknown>; maxSteps?: number } = {},
): FlowSimulation {
  const endings = (body.endings ?? []).map((e) => e.id);
  // Question-only block list (T13 compile SPEC-NOTE 2: renderers pass the
  // filtered list) — the preview walks the conversational flow, which never
  // stops on content blocks.
  const routing = compile(body.logic?.rules ?? [], questionBlocks(body.blocks ?? []), endings);
  const urlParams = opts.urlParams as Record<string, string> | undefined;
  const prefilled = prefillAnswers(body, urlParams ?? {});

  const steps: FlowStep[] = [];
  const variables: Record<string, unknown> = {};
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  const mergedAnswers = (): Record<string, unknown> => ({ ...prefilled, ...answers });

  // Resolve the first question from the synthetic "start" scope.
  const first = evaluate(routing, {
    answers: mergedAnswers(),
    variables,
    hidden: opts.hidden ?? {},
    urlParams: opts.urlParams ?? {},
    currentBlockId: "start",
  });
  Object.assign(variables, first.variables);
  if (!first.nextBlockId.startsWith("end:") && first.nextBlockId === "start") {
    return { steps, ending: null, truncated: false }; // degenerate program
  }

  let current = first.nextBlockId;
  for (let i = 0; i < maxSteps; i++) {
    if (current.startsWith("end:")) {
      return { steps, ending: current, truncated: false };
    }
    const result = evaluate(routing, {
      answers: mergedAnswers(),
      variables,
      hidden: opts.hidden ?? {},
      urlParams: urlParams ?? {},
      currentBlockId: current,
    });
    Object.assign(variables, result.variables);
    steps.push({
      blockId: current,
      answer: answers[current] ?? prefilled[current],
      next: result.nextBlockId,
      variables: { ...variables },
    });
    if (result.nextBlockId === current) {
      return { steps, ending: null, truncated: false }; // stuck (empty defaultNext)
    }
    current = result.nextBlockId;
  }
  return { steps, ending: null, truncated: true };
}

/**
 * Sample answers for the preview UI: one plausible value per question kind so
 * "Preview" walks the whole flow without the user typing anything. Values in
 * `overrides` win (e.g. the NPS slider in the preview panel).
 */
export function sampleAnswers(
  body: DocumentBody,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const block of questionBlocks(body.blocks ?? [])) {
    out[block.id] = sampleAnswerFor(block.kind, block.props, overrides[block.id]);
  }
  return { ...out, ...overrides };
}

function sampleAnswerFor(
  kind: string,
  props: Record<string, unknown>,
  override: unknown,
): unknown {
  if (override !== undefined) return override;
  switch (kind) {
    case "short-text":
      return "Ada Lovelace";
    case "long-text":
      return "Something worth reading.";
    case "email":
      return "ada@example.com";
    case "number":
      return typeof props.min === "number" ? props.min : 7;
    case "rating": {
      const scale = typeof props.scale === "number" ? props.scale : 5;
      return scale; // top score — pairs with the NPS override for detractor tests
    }
    case "nps":
      return 10;
    case "single-select":
    case "dropdown": {
      const options = Array.isArray(props.options) ? props.options : [];
      const first = options[0] as { id?: unknown } | undefined;
      return typeof first?.id === "string" ? { optionId: first.id } : { optionId: "opt1" };
    }
    case "multi-select": {
      const options = Array.isArray(props.options) ? props.options : [];
      const ids = options
        .map((o) => (o && typeof o === "object" && "id" in o ? String((o as { id: unknown }).id) : ""))
        .filter((id) => id !== "");
      return { optionIds: ids.slice(0, 1) };
    }
    default:
      return null;
  }
}
