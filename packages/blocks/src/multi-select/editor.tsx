// packages/blocks — `multi-select` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import {
  CanvasPreview,
  GenericQuestionFields,
  OptionsFields,
  OptionalNumberField,
} from "../shared/question-editor-kit";
import { MultiSelectRender } from "./render";
import type { MultiSelectProps } from "./schema";

export const MultiSelectEditor: FC<
  EditorProps<MultiSelectProps> & { urlParams?: Record<string, string> }
> = ({ props, onChange, disabled, urlParams }) => (
  <div className="ff-editor ff-editor--multi-select" data-kind="multi-select">
    <CanvasPreview kind="multi-select" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <MultiSelectRender props={props} urlParams={params} disabled />}
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
      <div className="ff-editor__field">
        <span>Options</span>
        <OptionsFields
          options={props.options}
          onOptionsChange={(options) => onChange({ ...props, options })}
          disabled={disabled}
        />
      </div>
      <OptionalNumberField
        label="Min selections"
        value={props.min}
        min={0}
        disabled={disabled}
        onValue={(min) => onChange({ ...props, min })}
      />
      <OptionalNumberField
        label="Max selections"
        value={props.max}
        min={1}
        disabled={disabled}
        onValue={(max) => onChange({ ...props, max })}
      />
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
