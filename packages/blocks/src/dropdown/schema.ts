// packages/blocks — `dropdown` props + answer schema (spec §7.2: label,
// options, searchable; answer: { optionId }). OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";
import { OptionList, findOption, knownOptionIds } from "../shared/option-list";

export const DropdownProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  options: OptionList,
  // §7.2 "dropdown (searchable)": the searchable filter input is rendered by
  // the renderer; the flag only travels in props and is observable at render.
  searchable: z.boolean().default(false),
});

export type DropdownProps = z.infer<typeof DropdownProps>;

// §7.2 "Answer value: { optionId }" — dropdowns never accept {other}.
export const DropdownAnswer = z.object({ optionId: z.string().min(1) });

export type DropdownAnswer = z.infer<typeof DropdownAnswer>;

export function validateDropdown(
  answer: DropdownAnswer,
  props: DropdownProps,
): string | null {
  const id = typeof answer?.optionId === "string" ? answer.optionId : "";
  if (id === "") return props.required ? "This field is required" : null;
  return knownOptionIds(props.options).includes(id) ? null : "Unknown option";
}

/** Prefill from the `prefillParam` URL param — option id or label only. */
export function prefillDropdown(
  props: DropdownProps,
  params: UrlParams,
): DropdownAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  if (raw === null) return undefined;
  const match = findOption(props.options, raw);
  return match ? { optionId: match.id } : undefined;
}

export const dropdownDefaultProps = (): DropdownProps => ({
  label: "Choose from the list",
  options: [
    { id: "opt_0001", label: "Option 1" },
    { id: "opt_0002", label: "Option 2" },
  ],
  searchable: false,
  required: false,
});
