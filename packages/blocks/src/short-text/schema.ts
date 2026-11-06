// packages/blocks — `short-text` props + answer schema (spec §7.2: label,
// placeholder, required, maxLength + generic question props; answer: string).
// OWNED BY T06 (issue #6).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";

export const ShortTextProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  placeholder: z.string().max(500).default(""),
  maxLength: z.number().int().positive().max(10000).optional(),
});

export type ShortTextProps = z.infer<typeof ShortTextProps>;

// Answer value is `string` per §7.2. An empty string is schema-valid: the
// required-ness is a `validate` concern, because an unanswered optional
// question is represented as "" / absent, not as a schema error.
export const ShortTextAnswer = z.string();

export type ShortTextAnswer = z.infer<typeof ShortTextAnswer>;

export function validateShortText(
  answer: string,
  props: ShortTextProps,
): string | null {
  if (props.required && answer.trim() === "") {
    return "This field is required";
  }
  if (props.maxLength !== undefined && answer.length > props.maxLength) {
    return `Must be at most ${props.maxLength} characters`;
  }
  return null;
}

export const shortTextDefaultProps = (): ShortTextProps => ({
  label: "Short answer",
  placeholder: "",
  required: false,
});
