// packages/blocks — `rating` public renderer (client-interactive, server-safe).
// OWNED BY T09 (issue #9).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { prefillRating, ratingScale } from "./schema";
import type { RatingAnswer, RatingIcon, RatingProps } from "./schema";

// Glyphs per §7.2 `icon`; unknown values fall back to the raw string. The
// `number` variant renders bare numeric buttons — no glyph at all.
const GLYPHS: Record<RatingIcon, string> = {
  star: "★",
  heart: "♥",
  thumbs: "👍",
  number: "",
};

export const RatingRender: FC<RenderProps<RatingProps, RatingAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  const scale = ratingScale(props);
  const glyph = GLYPHS[props.icon] ?? props.icon;
  const current = answer ?? prefillRating(props, urlParams);
  const selected = typeof current === "number" && Number.isInteger(current) ? current : null;
  return (
    <QuestionShell
      kind="rating"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      <div
        role="radiogroup"
        aria-label={props.label}
        data-scale={scale}
        data-icon={props.icon}
      >
        {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected === n}
            aria-label={`${n} out of ${scale}`}
            data-value={n}
            disabled={disabled}
            onClick={() => onAnswer?.(n)}
          >
            {/* §9.2 `number` icon variant: bare numeric buttons, no glyph. */}
            {props.icon === "number" ? null : (
              <span aria-hidden="true">{glyph}</span>
            )}
            <span aria-hidden="true">{n}</span>
          </button>
        ))}
      </div>
    </QuestionShell>
  );
};
