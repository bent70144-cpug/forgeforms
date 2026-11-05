// packages/blocks — `button` builder editor (stub; T08/T09 build the real UI).
// OWNED BY T06 (issue #6).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { ButtonProps } from "./schema";

export const ButtonEditor: FC<EditorProps<ButtonProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--button" data-kind="button">
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
      <span>Link (href)</span>
      <input
        type="text"
        value={props.href}
        disabled={disabled}
        onChange={(event) => onChange({ ...props, href: event.target.value })}
      />
    </label>
    <label className="ff-editor__field">
      <span>Style</span>
      <select
        value={props.style}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...props, style: event.target.value as ButtonProps["style"] })
        }
      >
        <option value="primary">Primary</option>
        <option value="secondary">Secondary</option>
        <option value="ghost">Ghost</option>
      </select>
    </label>
  </div>
);
