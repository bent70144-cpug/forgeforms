// packages/blocks — `nps` props + answer schema (spec §7.2: label, leftLabel,
// rightLabel; answer: number 0–10). OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";

export const NpsProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  leftLabel: z.string().max(200).default(""),
  rightLabel: z.string().max(200).default(""),
});

export type NpsProps = z.infer<typeof NpsProps>;

// §7.2 "Answer value: number 0–10" — exactly the ingest bootstrap registry's
// nps answerSchema.
export const NpsAnswer = z.number().int().min(0).max(10);

export type NpsAnswer = z.infer<typeof NpsAnswer>;

/** Clamp any number into the 0–10 NPS range. ±Infinity clamps to the nearest
 * bound; NaN (no meaningful score) degrades to 0. */
export function clampNps(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(10, Math.max(0, Math.round(value)));
}

export function validateNps(answer: number, props: NpsProps): string | null {
  if (!Number.isFinite(answer)) {
    return props.required ? "This field is required" : null;
  }
  if (!Number.isInteger(answer) || answer < 0 || answer > 10) {
    return "Must be between 0 and 10";
  }
  return null;
}

/** Prefill from the `prefillParam` URL param, clamped into 0–10. */
export function prefillNps(props: NpsProps, params: UrlParams): NpsAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  if (raw === null) return undefined;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? clampNps(parsed) : undefined;
}

export const npsDefaultProps = (): NpsProps => ({
  label: "How likely are you to recommend us?",
  leftLabel: "Not likely",
  rightLabel: "Very likely",
  required: false,
});
