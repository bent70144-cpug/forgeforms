// packages/blocks — `number` props + answer schema (spec §7.2: label, required,
// min, max; answer: number) + generic question props. OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";

export const NumberProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  // Bounds are optional; a min > max config is the author's mistake and is
  // reported by `validate` (both bounds are checked independently).
  min: z.number().optional(),
  max: z.number().optional(),
});

export type NumberProps = z.infer<typeof NumberProps>;

// §7.2 "Answer value: number". Zod 4's z.number() already rejects NaN and
// non-finite values, so garbage URLs / blank inputs can never pass ingest.
export const NumberAnswer = z.number();

export type NumberAnswer = z.infer<typeof NumberAnswer>;

export function validateNumber(answer: number, props: NumberProps): string | null {
  if (!Number.isFinite(answer)) {
    return props.required ? "This field is required" : null;
  }
  if (props.min !== undefined && answer < props.min) {
    return `Must be at least ${props.min}`;
  }
  if (props.max !== undefined && answer > props.max) {
    return `Must be at most ${props.max}`;
  }
  return null;
}

/** Prefill from the `prefillParam` URL param — only when it parses as a number. */
export function prefillNumber(props: NumberProps, params: UrlParams): NumberAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  if (raw === null) return undefined;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const numberDefaultProps = (): NumberProps => ({
  label: "Number",
  required: false,
});
