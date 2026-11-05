// packages/blocks — `hero` builder editor (stub; T08/T09 build the real UI).
// OWNED BY T06 (issue #6).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { HeroProps } from "./schema";

export const HeroEditor: FC<EditorProps<HeroProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--hero" data-kind="hero">
    <label className="ff-editor__field">
      <span>Title</span>
      <input
        type="text"
        value={props.title}
        disabled={disabled}
        onChange={(event) => onChange({ ...props, title: event.target.value })}
      />
    </label>
    <label className="ff-editor__field">
      <span>Subtitle</span>
      <input
        type="text"
        value={props.subtitle}
        disabled={disabled}
        onChange={(event) => onChange({ ...props, subtitle: event.target.value })}
      />
    </label>
  </div>
);
