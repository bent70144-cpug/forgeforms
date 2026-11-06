// packages/blocks — `email` public renderer (client-interactive, server-safe).
// OWNED BY T09 (issue #9).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { prefillEmail } from "./schema";
import type { EmailAnswer, EmailProps } from "./schema";

export const EmailRender: FC<RenderProps<EmailProps, EmailAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  // §7.2 generic `prefillParam`: URL param prefills the visible value until an
  // answer exists (explicit answers always win).
  const value = answer ?? prefillEmail(props, urlParams) ?? "";
  return (
    <QuestionShell
      kind="email"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      <input
        type="email"
        name="answer"
        value={value}
        disabled={disabled}
        onChange={(event) => onAnswer?.(event.target.value)}
      />
    </QuestionShell>
  );
};
