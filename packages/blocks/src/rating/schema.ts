// packages/blocks — `rating` props + answer schema (spec §7.2: label,
// scale(3-10), icon; answer: number). OWNED BY T09 (issue #9).
import { z } from "zod";
import { QuestionPropsBase } from "../shared/question-props";
import { rawParam, type UrlParams } from "../shared/prefill";

// §7.2 "rating (scale 3–10, icon)". The icon variants mirror the builder
// palette (star/hearts/thumbs); glyphs are resolved at render time.
export const RatingIcon = z.enum(["star", "heart", "thumbs"]);

export const RatingProps = QuestionPropsBase.extend({
  label: z.string().min(1).max(1000),
  scale: z.number().int().min(3).max(10).default(5),
  icon: RatingIcon.default("star"),
});

export type RatingIcon = z.infer<typeof RatingIcon>;
export type RatingProps = z.infer<typeof RatingProps>;

// §7.2 "Answer value: number" — a whole rating from 1 to props.scale.
export const RatingAnswer = z.number().int();

export type RatingAnswer = z.infer<typeof RatingAnswer>;

/** Defensive clamp for raw (unparsed) author props coming from client code. */
export function ratingScale(props: Pick<RatingProps, "scale">): number {
  return Math.min(10, Math.max(3, props.scale ?? 5));
}

export function validateRating(answer: number, props: RatingProps): string | null {
  if (!Number.isFinite(answer) || !Number.isInteger(answer)) {
    return props.required ? "This field is required" : null;
  }
  const scale = ratingScale(props);
  if (answer < 1 || answer > scale) {
    return `Must be between 1 and ${scale}`;
  }
  return null;
}

/** Prefill from the `prefillParam` URL param, clamped into 1..scale. */
export function prefillRating(props: RatingProps, params: UrlParams): RatingAnswer | undefined {
  const raw = rawParam(params, props.prefillParam);
  if (raw === null) return undefined;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return undefined;
  const scale = ratingScale(props);
  return Math.min(scale, Math.max(1, Math.round(parsed)));
}

export const ratingDefaultProps = (): RatingProps => ({
  label: "Rating",
  scale: 5,
  icon: "star",
  required: false,
});
