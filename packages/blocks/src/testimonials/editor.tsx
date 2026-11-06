// packages/blocks — `testimonials` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { TestimonialItem, TestimonialsProps } from "./schema";

function emptyItem(): TestimonialItem {
  return { quote: "", name: "", role: "" };
}

export const TestimonialsEditor: FC<EditorProps<TestimonialsProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--testimonials" data-kind="testimonials">
    <p className="ff-editor__hint">{props.items.length} testimonial(s)</p>
    {props.items.map((item, index) => (
      <fieldset key={index} className="ff-editor__group">
        <legend>Testimonial {index + 1}</legend>
        <label className="ff-editor__field">
          <span>Quote</span>
          <textarea
            rows={3}
            value={item.quote}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = { ...item, quote: event.target.value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Name</span>
          <input
            type="text"
            value={item.name}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = { ...item, name: event.target.value };
              onChange({ ...props, items });
            }}
          />
        </label>
        <label className="ff-editor__field">
          <span>Role</span>
          <input
            type="text"
            value={item.role}
            disabled={disabled}
            onChange={(event) => {
              const items = [...props.items];
              items[index] = { ...item, role: event.target.value };
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
      disabled={disabled || props.items.length >= 20}
      onClick={() => onChange({ ...props, items: [...props.items, emptyItem()] })}
    >
      Add testimonial
    </button>
  </div>
);
