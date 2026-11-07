// packages/blocks — `text` block definition; registers at import time (§7.1).
// Follow-up #6 (builder-audit §9.4 FAIL): richText as Tiptap JSON, sanitized on
// render through the §17 allowlist sanitizer, Tiptap editor lazy-loaded (§13).
import { registerBlock, type BlockDef } from "../registry";
import { TextEditor } from "./editor";
import { TextRender } from "./render";
import { TextProps, textDefaultProps } from "./schema";

export const textBlock: BlockDef<TextProps> = {
  kind: "text",
  family: "content",
  label: "Text",
  icon: "type",
  propsSchema: TextProps,
  defaultProps: textDefaultProps,
  Editor: TextEditor,
  Render: TextRender,
};

registerBlock(textBlock);
