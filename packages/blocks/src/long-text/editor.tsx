// packages/blocks — `long-text` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import {
  CanvasPreview,
  GenericQuestionFields,
  OptionalNumberField,
} from "../shared/question-editor-kit";
import { LongTextRender } from "./render";
import type { LongTextProps } from "./schema";

export const LongTextEditor: FC<
  EditorProps<LongTextProps> & { urlParams?: Record<string, string> }
> = ({ props, onChange, disabled, urlParams }) => (
  <div className="ff-editor ff-editor--long-text" data-kind="long-text">
    <CanvasPreview kind="long-text" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <LongTextRender props={props} urlParams={params} disabled />}
    </CanvasPreview>
    <div className="ff-editor__settings">
      <label className="ff-editor__field">
        <span>Label</span>
        <input
          type="text"
          value={props.label}
          disabled={disabled}
          onChange={(event) => onChange({ ...props, label: event.target.value })}
        />
      </label>
      <label className="ff-editor__field">
        <span>Placeholder</span>
        <textarea
          value={props.placeholder}
          disabled={disabled}
          onChange={(event) => onChange({ ...props, placeholder: event.target.value })}
        />
      </label>
      <OptionalNumberField
        label="Max length"
        value={props.maxLength}
        min={1}
        disabled={disabled}
        onValue={(maxLength) => onChange({ ...props, maxLength })}
      />
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
