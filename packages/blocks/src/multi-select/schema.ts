// packages/blocks — `multi-select` props + answer schema (spec §7.2: label,
// options, min, max; answer: { optionIds: string[] }). OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";
import { OptionList, findOption, knownOptionIds } from "../shared/option-list";

export const MultiSelectProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  options: OptionList,
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(1).optional(),
});

export type MultiSelectProps = z.infer<typeof MultiSelectProps>;

// §7.2 "Answer value: { optionIds: string[] }" — same shape as the ingest
// bootstrap registry's multiSelectAnswer.
export const MultiSelectAnswer = z.object({
  optionIds: z.array(z.string()),
});

export type MultiSelectAnswer = z.infer<typeof MultiSelectAnswer>;

export function validateMultiSelect(
  answer: MultiSelectAnswer,
  props: MultiSelectProps,
): string | null {
  const ids = Array.isArray(answer?.optionIds) ? answer.optionIds : [];
  if (ids.some((id) => typeof id !== "string" || !knownOptionIds(props.options).includes(id))) {
    return "Unknown option";
  }
  if (props.min !== undefined && ids.length < props.min) {
    return `Select at least ${props.min}`;
  }
  if (props.max !== undefined && ids.length > props.max) {
    return `Select at most ${props.max}`;
  }
  if (props.required && ids.length === 0) {
    return "This field is required";
  }
  return null;
}

/** Prefill: comma-separated URL param values matched by option id or label. */
export function prefillMultiSelect(
  props: MultiSelectProps,
  params: UrlParams,
): MultiSelectAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  if (raw === null) return undefined;
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const match = findOption(props.options, part.trim());
    if (match && !ids.includes(match.id)) ids.push(match.id);
  }
  return ids.length > 0 ? { optionIds: ids } : undefined;
}

export const multiSelectDefaultProps = (): MultiSelectProps => ({
  label: "Pick any",
  options: [
    { id: "opt_0001", label: "Option 1" },
    { id: "opt_0002", label: "Option 2" },
  ],
  required: false,
});
