// packages/blocks — `single-select` public renderer (client-interactive,
// server-safe). OWNED BY T09 (issue #9).
import { useMemo, type CSSProperties, type FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { shuffledOptions } from "../shared/option-list";
import { prefillSingleSelect } from "./schema";
import type { SingleSelectAnswer, SingleSelectProps } from "./schema";

/**
 * §9.2 display modes. `list` keeps the classic vertical stack (default, zero
 * change for existing documents); `grid`/`picture` reuse the exact same radio
 * inputs laid out as tiles — the semantic answer value is identical in every
 * mode, only the presentation changes.
 */
const GRID_TILE_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  gap: "0.75rem",
};

export const SingleSelectRender: FC<RenderProps<SingleSelectProps, SingleSelectAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  // §7.2 `randomize`: shuffle the visible order (stable across re-renders for
  // the same options via useMemo; deterministic under a seeded rng in tests).
  const options = useMemo(
    () => (props.randomize ? shuffledOptions(props.options) : props.options),
    [props.randomize, props.options],
  );
  const current = answer ?? prefillSingleSelect(props, urlParams);
  const selectedId =
    current && "optionId" in current && typeof current.optionId === "string"
      ? current.optionId
      : null;
  const other =
    current && "other" in current && typeof current.other === "string" ? current.other : null;
  const mode = props.displayMode ?? "list";
  const tiled = mode === "grid" || mode === "picture";
  return (
    <QuestionShell
      kind="single-select"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      <div
        role="radiogroup"
        aria-label={props.label}
        data-display-mode={mode}
        className={tiled ? `ff-select-options--${mode}` : undefined}
        style={tiled ? GRID_TILE_STYLE : undefined}
      >
        {options.map((option) => (
          <label
            key={option.id}
            className={tiled ? `ff-option ff-option--${mode}` : "ff-option"}
          >
            {/* §9.2 `picture` mode: a label card with an image slot. Options
                stay {id,label} (shared OptionList), so the slot renders empty
                until the §10 asset picker can attach images to options. */}
            {mode === "picture" ? (
              <span className="ff-option__picture" aria-hidden="true" data-option-picture="" />
            ) : null}
            <input
              type="radio"
              name="answer"
              value={option.id}
              checked={selectedId === option.id}
              disabled={disabled}
              onChange={() => onAnswer?.({ optionId: option.id })}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {props.allowOther ? (
          <label className="ff-option ff-option--other">
            <input
              type="radio"
              name="answer"
              checked={other !== null}
              disabled={disabled}
              onChange={() => onAnswer?.({ other: "" })}
            />
            <input
              type="text"
              name="answer-other"
              value={other ?? ""}
              placeholder="Other"
              disabled={disabled}
              onChange={(event) => onAnswer?.({ other: event.target.value })}
            />
          </label>
        ) : null}
      </div>
    </QuestionShell>
  );
};
