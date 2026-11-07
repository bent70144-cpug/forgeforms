// packages/blocks — `single-select` props + answer schema (spec §7.2: label,
// options[{id,label}], allowOther, randomize; answer: {optionId} or {other}).
// OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";
import { OptionList, findOption, knownOptionIds, type Option } from "../shared/option-list";

// §9.2 display modes: `list` is the classic vertical radio stack; `grid` lays
// the same radios out on a grid; `picture` renders label cards (image slots
// light up once the §10 asset picker can attach images to options).
export const SelectDisplayMode = z.enum(["list", "grid", "picture"]);

export const SingleSelectProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  options: OptionList,
  allowOther: z.boolean().default(false),
  randomize: z.boolean().default(false),
  displayMode: SelectDisplayMode.default("list"),
});

export type SelectDisplayMode = z.infer<typeof SelectDisplayMode>;
export type SingleSelectProps = z.infer<typeof SingleSelectProps>;

// §7.2 "Answer value: { optionId } or { other: string }" — a union, exactly
// like the ingest bootstrap registry. Objects strip (not reject) unknown keys
// so { optionId: "", other: "x" } parses as { other: "x" }.
export const SingleSelectAnswer = z.union([
  z.object({ optionId: z.string().min(1) }),
  z.object({ other: z.string() }),
]);

export type SingleSelectAnswer = z.infer<typeof SingleSelectAnswer>;

export function validateSingleSelect(
  answer: SingleSelectAnswer,
  props: SingleSelectProps,
): string | null {
  const other = "other" in answer && typeof answer.other === "string" ? answer.other : undefined;
  const optionId =
    "optionId" in answer && typeof answer.optionId === "string" ? answer.optionId : undefined;

  if (other !== undefined) {
    if (props.allowOther !== true) return "Custom answers are not allowed";
    if (other.trim() === "") return props.required ? "This field is required" : null;
    return null;
  }
  if (optionId !== undefined && optionId !== "") {
    return knownOptionIds(props.options).includes(optionId) ? null : "Unknown option";
  }
  return props.required ? "This field is required" : null;
}

/**
 * Prefill from the `prefillParam` URL param: exact option id first, then exact
 * label; anything else becomes an {other} answer when allowOther is on.
 */
export function prefillSingleSelect(
  props: SingleSelectProps,
  params: UrlParams,
): SingleSelectAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  if (raw === null) return undefined;
  const match = findOption(props.options, raw);
  if (match) return { optionId: match.id };
  if (props.allowOther) return { other: raw };
  return undefined;
}

export const singleSelectDefaultOptions = (): Option[] => [
  { id: "opt_0001", label: "Option 1" },
  { id: "opt_0002", label: "Option 2" },
];

export const singleSelectDefaultProps = (): SingleSelectProps => ({
  label: "Pick one",
  options: singleSelectDefaultOptions(),
  allowOther: false,
  randomize: false,
  displayMode: "list",
  required: false,
});
