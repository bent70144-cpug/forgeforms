// packages/blocks — `columns` builder editor (settings panel; T08 owns layout).
// §9.2 additions: per-column desktop ratio weights and mobile stack-order ranks.
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { ColumnsProps } from "./schema";

export const ColumnsEditor: FC<EditorProps<ColumnsProps>> = ({ props, onChange, disabled }) => {
  const count = props.count;
  // Ratios/stack order are positional arrays; a first interaction materializes
  // them at the current count (missing entries fall back to the defaults).
  const ratios = Array.from({ length: count }, (_, i) => props.ratios?.[i] ?? 1);
  const stackOrder = Array.from({ length: count }, (_, i) => props.stackOrder?.[i] ?? i + 1);
  const setRatio = (index: number, value: number): void => {
    const next = [...ratios];
    next[index] = value;
    onChange({ ...props, ratios: next });
  };
  const setStackRank = (index: number, value: number): void => {
    const next = [...stackOrder];
    next[index] = value;
    onChange({ ...props, stackOrder: next });
  };
  return (
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
      <fieldset className="ff-editor__field" data-ratios-editor>
        <legend>Column ratios (desktop)</legend>
        {ratios.map((ratio, index) => (
          <label key={`ratio-${index}`} className="ff-editor__field">
            <span>{`Column ${index + 1}`}</span>
            <input
              type="number"
              min={1}
              max={12}
              aria-label={`Column ${index + 1} ratio`}
              value={ratio}
              disabled={disabled}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) setRatio(index, parsed);
              }}
            />
          </label>
        ))}
      </fieldset>
      <fieldset className="ff-editor__field" data-stack-order-editor>
        <legend>Mobile stack order</legend>
        {stackOrder.map((rank, index) => (
          <label key={`stack-${index}`} className="ff-editor__field">
            <span>{`Column ${index + 1}`}</span>
            <input
              type="number"
              min={1}
              max={4}
              aria-label={`Column ${index + 1} mobile stack order`}
              value={rank}
              disabled={disabled}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4) setStackRank(index, parsed);
              }}
            />
          </label>
        ))}
      </fieldset>
      <p className="ff-editor__hint">Add child blocks from the Blocks tree; they fill the grid in order.</p>
    </div>
  );
};
