// packages/blocks — `nps` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import { CanvasPreview, GenericQuestionFields } from "../shared/question-editor-kit";
import { NpsRender } from "./render";
import type { NpsProps } from "./schema";

export const NpsEditor: FC<EditorProps<NpsProps> & { urlParams?: Record<string, string> }> = ({
  props,
  onChange,
  disabled,
  urlParams,
}) => (
  <div className="ff-editor ff-editor--nps" data-kind="nps">
    <CanvasPreview kind="nps" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <NpsRender props={props} urlParams={params} disabled />}
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
        <span>Left label</span>
        <input
          type="text"
          value={props.leftLabel}
          disabled={disabled}
          onChange={(event) => onChange({ ...props, leftLabel: event.target.value })}
        />
      </label>
      <label className="ff-editor__field">
        <span>Right label</span>
        <input
          type="text"
          value={props.rightLabel}
          disabled={disabled}
          onChange={(event) => onChange({ ...props, rightLabel: event.target.value })}
        />
      </label>
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
