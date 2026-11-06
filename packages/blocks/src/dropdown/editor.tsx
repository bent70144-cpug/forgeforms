// packages/blocks — `dropdown` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import {
  CanvasPreview,
  GenericQuestionFields,
  OptionsFields,
} from "../shared/question-editor-kit";
import { DropdownRender } from "./render";
import type { DropdownProps } from "./schema";

export const DropdownEditor: FC<
  EditorProps<DropdownProps> & { urlParams?: Record<string, string> }
> = ({ props, onChange, disabled, urlParams }) => (
  <div className="ff-editor ff-editor--dropdown" data-kind="dropdown">
    <CanvasPreview kind="dropdown" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <DropdownRender props={props} urlParams={params} disabled />}
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
          checked={props.searchable}
          disabled={disabled}
          onChange={(event) => onChange({ ...props, searchable: event.target.checked })}
        />
        <span>Searchable</span>
      </label>
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
