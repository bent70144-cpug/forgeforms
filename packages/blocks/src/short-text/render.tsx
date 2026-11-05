// packages/blocks — `short-text` public renderer (client-interactive).
// OWNED BY T06 (issue #6).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import type { ShortTextAnswer, ShortTextProps } from "./schema";

export const ShortTextRender: FC<RenderProps<ShortTextProps, ShortTextAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
}) => (
  <div className="ff-question ff-question--short-text" data-block-kind="short-text">
    {props.description ? <p className="ff-question__description">{props.description}</p> : null}
    <label className="ff-question__label">
      <span>
        {props.label}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <input
        type="text"
        name="answer"
        value={answer ?? ""}
        placeholder={props.placeholder || undefined}
        maxLength={props.maxLength}
        disabled={disabled}
        onChange={(event) => onAnswer?.(event.target.value)}
      />
    </label>
  </div>
);
