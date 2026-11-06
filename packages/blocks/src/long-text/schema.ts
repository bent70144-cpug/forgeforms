// packages/blocks — `long-text` props + answer schema (spec §7.2: label,
// placeholder, required, maxLength; answer: string) + generic question props.
// OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";

export const LongTextProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  placeholder: z.string().max(500).default(""),
  // Long-text allows longer answers than short-text (§7.2 lists maxLength
  // without a cap; 100k keeps stored bodies sane).
  maxLength: z.number().int().positive().max(100000).optional(),
});

export type LongTextProps = z.infer<typeof LongTextProps>;

// Answer value is `string` per §7.2. An empty string is schema-valid: the
// required-ness is a `validate` concern (see short-text/schema.ts).
export const LongTextAnswer = z.string();

export type LongTextAnswer = z.infer<typeof LongTextAnswer>;

export function validateLongText(answer: string, props: LongTextProps): string | null {
  if (props.required && answer.trim() === "") {
    return "This field is required";
  }
  if (props.maxLength !== undefined && answer.length > props.maxLength) {
    return `Must be at most ${props.maxLength} characters`;
  }
  return null;
}

/** Prefill from the `prefillParam` URL param — any non-empty text. */
export function prefillLongText(
  props: LongTextProps,
  params: UrlParams,
): LongTextAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  return raw === null ? undefined : raw;
}

export const longTextDefaultProps = (): LongTextProps => ({
  label: "Long answer",
  placeholder: "",
  required: false,
});
