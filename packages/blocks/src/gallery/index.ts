// packages/blocks — `gallery` block definition; registers at import time (§7.1).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { GalleryEditor } from "./editor";
import { GalleryRender } from "./render";
import { GalleryProps, galleryDefaultProps } from "./schema";

export const galleryBlock: BlockDef<GalleryProps> = {
  kind: "gallery",
  family: "content",
  label: "Gallery",
  icon: "images",
  propsSchema: GalleryProps,
  defaultProps: galleryDefaultProps,
  Editor: GalleryEditor,
  Render: GalleryRender,
};

registerBlock(galleryBlock);
