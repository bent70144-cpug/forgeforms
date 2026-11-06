// packages/blocks — `video` block definition; registers at import time (§7.1).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { VideoEditor } from "./editor";
import { VideoRender } from "./render";
import { VideoProps, videoDefaultProps } from "./schema";

export const videoBlock: BlockDef<VideoProps> = {
  kind: "video",
  family: "content",
  label: "Video",
  icon: "play",
  propsSchema: VideoProps,
  defaultProps: videoDefaultProps,
  Editor: VideoEditor,
  Render: VideoRender,
};

registerBlock(videoBlock);
