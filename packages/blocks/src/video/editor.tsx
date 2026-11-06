// packages/blocks — `video` builder editor (settings panel; T08 owns layout).
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { VideoProps } from "./schema";

export const VideoEditor: FC<EditorProps<VideoProps>> = ({ props, onChange, disabled }) => (
  <div className="ff-editor ff-editor--video" data-kind="video">
    <label className="ff-editor__field">
      <span>Video URL (YouTube or Vimeo)</span>
      <input
        type="url"
        value={props.url}
        placeholder="https://www.youtube.com/watch?v=…"
        disabled={disabled}
        onChange={(event) => onChange({ ...props, url: event.target.value })}
      />
    </label>
    <p className="ff-editor__hint">Only YouTube and Vimeo links are allowed.</p>
  </div>
);
