// packages/blocks — `number` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import {
  CanvasPreview,
  GenericQuestionFields,
  OptionalNumberField,
} from "../shared/question-editor-kit";
import { NumberRender } from "./render";
import type { NumberProps } from "./schema";

export const NumberEditor: FC<EditorProps<NumberProps> & { urlParams?: Record<string, string> }> = ({
  props,
  onChange,
  disabled,
  urlParams,
}) => (
  <div className="ff-editor ff-editor--number" data-kind="number">
    <CanvasPreview kind="number" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <NumberRender props={props} urlParams={params} disabled />}
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
      <OptionalNumberField
        label="Min"
        value={props.min}
        disabled={disabled}
        onValue={(min) => onChange({ ...props, min })}
      />
      <OptionalNumberField
        label="Max"
        value={props.max}
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
