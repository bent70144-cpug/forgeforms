// packages/blocks — `dropdown` public renderer (client-interactive, server-safe).
// OWNED BY T09 (issue #9).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { QuestionShell } from "../shared/question-editor-kit";
import { prefillDropdown } from "./schema";
import type { DropdownAnswer, DropdownProps } from "./schema";

export const DropdownRender: FC<RenderProps<DropdownProps, DropdownAnswer>> = ({
  props,
  answer,
  onAnswer,
  disabled,
  urlParams,
}) => {
  const current = answer ?? prefillDropdown(props, urlParams);
  const selectedId = typeof current?.optionId === "string" ? current.optionId : "";
  return (
    <QuestionShell
      kind="dropdown"
      label={props.label}
      required={props.required}
      description={props.description}
    >
      {/* SPEC-NOTE: `searchable` filtering is delivered by the conversational
          renderer (T10); the flag is exposed on the DOM for it to key off. */}
      <select
        name="answer"
        value={selectedId}
        data-searchable={props.searchable ? "true" : "false"}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === "") return;
          onAnswer?.({ optionId: event.target.value });
        }}
      >
        <option value="">Choose…</option>
        {props.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </QuestionShell>
  );
};
