// packages/blocks — `faq` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { FaqItem, FaqProps } from "./schema";

function emptyItem(): FaqItem {
  return { q: "", a: "" };
}

export const FaqEditor: FC<EditorProps<FaqProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--faq" data-kind="faq">
    <p className="ff-editor__hint">{props.items.length} question(s)</p>
    {props.items.map((item, index) => (
      <fieldset key={index} className="ff-editor__group">
        <legend>Q&amp;A {index + 1}</legend>
        <label className="ff-editor__field">
          <span>Question</span>
          <input
            type="text"
            value={item.q}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = { ...item, q: event.target.value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Answer</span>
          <textarea
            rows={3}
            value={item.a}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = { ...item, a: event.target.value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...props, items: props.items.filter((_, i) => i !== index) })}
        >
          Remove
        </button>
      </fieldset>
    ))}
    <button
      type="button"
      disabled={disabled || props.items.length >= 50}
      onClick={() => onChange({ ...props, items: [...props.items, emptyItem()] })}
    >
      Add question
    </button>
  </div>
);
