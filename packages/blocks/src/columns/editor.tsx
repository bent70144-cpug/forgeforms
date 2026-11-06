// packages/blocks — `columns` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { ColumnsProps } from "./schema";

export const ColumnsEditor: FC<EditorProps<ColumnsProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--columns" data-kind="columns">
    <label className="ff-editor__field">
      <span>Columns (2–4)</span>
      <input
        type="number"
        min={2}
        max={4}
        value={props.count}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isInteger(parsed) && parsed >= 2 && parsed <= 4) onChange({ ...props, count: parsed });
        }}
      />
    </label>
    <p className="ff-editor__hint">Add child blocks from the Blocks tree; they fill the grid in order.</p>
  </div>
);
