// packages/blocks — `form-embed` builder editor (settings panel).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { FormEmbedProps } from "./schema";

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
    <p className="ff-editor__hint">
      The target must be a published form; the frame posts ff:height and ff:complete events upward.
    </p>
  </div>
);
