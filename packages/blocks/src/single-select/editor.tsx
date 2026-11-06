// packages/blocks — `single-select` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import {
  CanvasPreview,
  GenericQuestionFields,
  OptionsFields,
} from "../shared/question-editor-kit";
import { SingleSelectRender } from "./render";
import type { SingleSelectProps } from "./schema";

export const SingleSelectEditor: FC<
  EditorProps<SingleSelectProps> & { urlParams?: Record<string, string> }
> = ({ props, onChange, disabled, urlParams }) => (
  <div className="ff-editor ff-editor--single-select" data-kind="single-select">
    <CanvasPreview kind="single-select" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <SingleSelectRender props={props} urlParams={params} disabled />}
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
      <label className="ff-editor__field ff-editor__field--checkbox">
        <input
          type="checkbox"
          checked={props.allowOther}
          disabled={disabled}
          onChange={(event) => onChange({ ...props, allowOther: event.target.checked })}
        />
        <span>Allow other</span>
      </label>
      <label className="ff-editor__field ff-editor__field--checkbox">
        <input
          type="checkbox"
          checked={props.randomize}
          disabled={disabled}
          onChange={(event) => onChange({ ...props, randomize: event.target.checked })}
        />
        <span>Randomize</span>
      </label>
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
