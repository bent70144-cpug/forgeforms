// packages/blocks — `number` public renderer (client-interactive, server-safe).
// OWNED BY T09 (issue #9).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { prefillNumber } from "./schema";
import type { NumberAnswer, NumberProps } from "./schema";

export const NumberRender: FC<RenderProps<NumberProps, NumberAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  const current = answer ?? prefillNumber(props, urlParams);
  const value = current !== undefined && Number.isFinite(current) ? String(current) : "";
  return (
    <QuestionShell
      kind="number"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      <input
        type="number"
        name="answer"
        value={value}
        min={props.min}
        max={props.max}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw.trim() === "") return; // cleared → keep the previous answer
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onAnswer?.(parsed);
        }}
      />
    </QuestionShell>
  );
};
