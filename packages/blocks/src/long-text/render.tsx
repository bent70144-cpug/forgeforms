// packages/blocks — `long-text` public renderer (client-interactive, server-safe).
// OWNED BY T09 (issue #9).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { prefillLongText } from "./schema";
import type { LongTextAnswer, LongTextProps } from "./schema";

export const LongTextRender: FC<RenderProps<LongTextProps, LongTextAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  const value = answer ?? prefillLongText(props, urlParams) ?? "";
  return (
    <QuestionShell
      kind="long-text"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      <textarea
        name="answer"
        rows={4}
        value={value}
        placeholder={props.placeholder || undefined}
        maxLength={props.maxLength}
        disabled={disabled}
        onChange={(event) => onAnswer?.(event.target.value)}
      />
    </QuestionShell>
  );
};
