// packages/blocks — `form-embed` builder editor (settings panel).
// §9.2 additions: layout mode + height mode (+ fixed height when pinned).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import { FormEmbedHeightMode, FormEmbedLayout } from "./schema";
import type { FormEmbedProps } from "./schema";

const LAYOUT_LABELS: Record<FormEmbedLayout, string> = {
  inline: "Inline",
  card: "Card",
};

const HEIGHT_MODE_LABELS: Record<FormEmbedHeightMode, string> = {
  auto: "Auto (resize with form)",
  fixed: "Fixed height",
};

export const FormEmbedEditor: FC<EditorProps<FormEmbedProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--form-embed" data-kind="form-embed">
    <label className="ff-editor__field">
      <span>Form document id</span>
      <input
        type="text"
        value={props.documentId}
        placeholder="doc_…"
        disabled={disabled}
        onChange={(event) => onChange({ ...props, documentId: event.target.value })}
      />
    </label>
    <label className="ff-editor__field">
      <span>Layout</span>
      <select
        value={props.layout ?? "inline"}
        disabled={disabled}
        onChange={(event) => {
          const parsed = FormEmbedLayout.safeParse(event.target.value);
          if (parsed.success) onChange({ ...props, layout: parsed.data });
        }}
      >
        {FormEmbedLayout.options.map((layout) => (
          <option key={layout} value={layout}>
            {LAYOUT_LABELS[layout]}
          </option>
        ))}
      </select>
    </label>
    <label className="ff-editor__field">
      <span>Height mode</span>
      <select
        value={props.heightMode ?? "auto"}
        disabled={disabled}
        onChange={(event) => {
          const parsed = FormEmbedHeightMode.safeParse(event.target.value);
          if (parsed.success) onChange({ ...props, heightMode: parsed.data });
        }}
      >
        {FormEmbedHeightMode.options.map((mode) => (
          <option key={mode} value={mode}>
            {HEIGHT_MODE_LABELS[mode]}
          </option>
        ))}
      </select>
    </label>
    {props.heightMode === "fixed" ? (
      <label className="ff-editor__field">
        <span>Fixed height (px)</span>
        <input
          type="number"
          min={120}
          max={2000}
          value={props.fixedHeight ?? 480}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isInteger(parsed) && parsed >= 120 && parsed <= 2000) {
              onChange({ ...props, fixedHeight: parsed });
            }
          }}
        />
      </label>
    ) : null}
    <p className="ff-editor__hint">
      The target must be a published form; the frame posts ff:height and ff:complete events upward.
    </p>
  </div>
);
