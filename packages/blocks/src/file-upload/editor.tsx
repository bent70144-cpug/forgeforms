// packages/blocks — `file-upload` builder editor: canvas preview + settings.
// Settings follow spec §7.2: label, accept[], maxSizeMb (≤ FILE_UPLOAD_BLOCK_MAX_MB),
// maxFiles — plus the generic question props.
import type { FC } from "react";
import type { EditorProps } from "../registry";
import { CanvasPreview, GenericQuestionFields, OptionalNumberField } from "../shared/question-editor-kit";
import { FileUploadRender } from "./render";
import {
  FILE_UPLOAD_BLOCK_MAX_MB,
  type FileUploadProps,
} from "./schema";

/** Split an `<input accept>` string into schema entries. */
function parseAcceptList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export const FileUploadEditor: FC<
  EditorProps<FileUploadProps> & { urlParams?: Record<string, string> }
> = ({ props, onChange, disabled, urlParams }) => (
  <div className="ff-editor ff-editor--file-upload" data-kind="file-upload">
    <CanvasPreview kind="file-upload" prefillParam={props.prefillParam} disabled={disabled} urlParams={urlParams}>
      {(params) => <FileUploadRender props={props} urlParams={params} disabled />}
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
        <span>Accepted types (comma-separated, e.g. image/png,.pdf)</span>
        <input
          type="text"
          value={props.accept.join(",")}
          placeholder="image/png,.pdf"
          disabled={disabled}
          onChange={(event) => onChange({ ...props, accept: parseAcceptList(event.target.value) })}
        />
      </label>
      <label className="ff-editor__field">
        <span>Max size (MB, up to {FILE_UPLOAD_BLOCK_MAX_MB})</span>
        <input
          type="number"
          value={props.maxSizeMb}
          min={1}
          max={FILE_UPLOAD_BLOCK_MAX_MB}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed) && parsed >= 1) {
              onChange({ ...props, maxSizeMb: Math.min(FILE_UPLOAD_BLOCK_MAX_MB, Math.floor(parsed)) });
            }
          }}
        />
      </label>
      <OptionalNumberField
        label="Max files"
        value={props.maxFiles}
        min={1}
        max={10}
        disabled={disabled}
        onValue={(maxFiles) => onChange({ ...props, maxFiles: maxFiles ?? 1 })}
      />
      <GenericQuestionFields
        props={props}
        onPatch={(patch) => onChange({ ...props, ...patch })}
        disabled={disabled}
      />
    </div>
  </div>
);
