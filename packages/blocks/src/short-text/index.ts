// packages/blocks — `short-text` block definition; registers at import time (§7.1).
// OWNED BY T06 (issue #6).
import { registerBlock, type BlockDef } from "../registry";
import { ShortTextEditor } from "./editor";
import { ShortTextRender } from "./render";
import {
  ShortTextAnswer,
  ShortTextProps,
  shortTextDefaultProps,
  validateShortText,
} from "./schema";

export const shortTextBlock: BlockDef<ShortTextProps, ShortTextAnswer> = {
  kind: "short-text",
  family: "question",
  label: "Short text",
  icon: "text-cursor-input",
  propsSchema: ShortTextProps,
  defaultProps: shortTextDefaultProps,
  answerSchema: ShortTextAnswer,
  validate: validateShortText,
  Editor: ShortTextEditor,
  Render: ShortTextRender,
};

registerBlock(shortTextBlock);
