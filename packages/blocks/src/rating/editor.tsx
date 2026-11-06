// packages/blocks — `rating` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import { CanvasPreview, GenericQuestionFields } from "../shared/question-editor-kit";
import { RatingRender } from "./render";
import { RatingIcon, ratingScale } from "./schema";
import type { RatingProps } from "./schema";

const ICON_LABELS: Record<RatingIcon, string> = {
  star: "Stars",
  heart: "Hearts",
  thumbs: "Thumbs",
};

export const RatingEditor: FC<
  EditorProps<RatingProps> & { urlParams?: Record<string, string> }
> = ({ props, onChange, disabled, urlParams }) => (
  <div className="ff-editor ff-editor--rating" data-kind="rating">
    <CanvasPreview kind="rating" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <RatingRender props={props} urlParams={params} disabled />}
    </CanvasPreview>
    <div className="ff-editor__settings">
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
        <span>Scale (3–10)</span>
        <input
          type="number"
          min={3}
          max={10}
          value={ratingScale(props)}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            // Keep the editor within the §7.2 3–10 bounds at all times.
            onChange({ ...props, scale: Math.min(10, Math.max(3, Math.round(parsed))) });
          }}
        />
      </label>
      <label className="ff-editor__field">
        <span>Icon</span>
        <select
          value={props.icon}
          disabled={disabled}
          onChange={(event) => {
            const parsed = RatingIcon.safeParse(event.target.value);
            if (parsed.success) onChange({ ...props, icon: parsed.data });
          }}
        >
          {RatingIcon.options.map((icon) => (
            <option key={icon} value={icon}>
              {ICON_LABELS[icon]}
            </option>
          ))}
        </select>
      </label>
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
