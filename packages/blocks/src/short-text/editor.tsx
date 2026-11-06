// packages/blocks — `short-text` builder editor (stub; T08/T09 build the real UI).
// OWNED BY T06 (issue #6).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { ShortTextProps } from "./schema";

export const ShortTextEditor: FC<EditorProps<ShortTextProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--short-text" data-kind="short-text">
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
      <input
        type="text"
        value={props.placeholder}
        disabled={disabled}
        onChange={(event) => onChange({ ...props, placeholder: event.target.value })}
      />
    </label>
    <label className="ff-editor__field ff-editor__field--checkbox">
      <input
        type="checkbox"
        checked={props.required}
        disabled={disabled}
        onChange={(event) => onChange({ ...props, required: event.target.checked })}
      />
      <span>Required</span>
    </label>
  </div>
);
