// packages/blocks — `email` builder editor: canvas preview + settings (T09).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import { CanvasPreview, GenericQuestionFields } from "../shared/question-editor-kit";
import { EmailRender } from "./render";
import type { EmailProps } from "./schema";

// `urlParams` is optional and injected by the host builder (live preview);
// registering Editor as FC<EditorProps<P>> stays valid because it is optional.
export const EmailEditor: FC<EditorProps<EmailProps> & { urlParams?: Record<string, string> }> = ({
  props,
  onChange,
  disabled,
  urlParams,
}) => (
  <div className="ff-editor ff-editor--email" data-kind="email">
    <CanvasPreview kind="email" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <EmailRender props={props} urlParams={params} disabled />}
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
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
