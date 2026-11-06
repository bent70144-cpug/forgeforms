// packages/blocks — `section` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { SectionPadding, SectionProps } from "./schema";

const PADDINGS: Array<{ value: SectionPadding; label: string }> = [
  { value: "none", label: "None" },
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra large" },
];

export const SectionEditor: FC<EditorProps<SectionProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--section" data-kind="section">
    <label className="ff-editor__field">
      <span>Background (token name, color or var())</span>
      <input
        type="text"
        value={props.background ?? ""}
        placeholder="bg / #f5f5f5 / var(--ff-muted)"
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value.trim();
          onChange({ ...props, background: value === "" ? undefined : value });
        }}
      />
    </label>
    <label className="ff-editor__field">
      <span>Padding</span>
      <select
        value={props.padding}
        disabled={disabled}
        onChange={(event) => onChange({ ...props, padding: event.target.value as SectionPadding })}
      >
        {PADDINGS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
    <p className="ff-editor__hint">Add child blocks from the Blocks tree.</p>
  </div>
);
