// packages/blocks — `multi-select` public renderer (client-interactive,
// server-safe). OWNED BY T09 (issue #9).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { prefillMultiSelect } from "./schema";
import type { MultiSelectAnswer, MultiSelectProps } from "./schema";

export const MultiSelectRender: FC<RenderProps<MultiSelectProps, MultiSelectAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  const current = answer ?? prefillMultiSelect(props, urlParams);
  const selected: string[] = current?.optionIds ?? [];
  const toggle = (optionId: string): void => {
    onAnswer?.({
      optionIds: selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId],
    });
  };
  return (
    <QuestionShell
      kind="multi-select"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      <div role="group" aria-label={props.label}>
        {props.options.map((option) => (
          <label key={option.id} className="ff-option">
            <input
              type="checkbox"
              name="answer"
              value={option.id}
              checked={selected.includes(option.id)}
              disabled={disabled}
              onChange={() => toggle(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </QuestionShell>
  );
};
