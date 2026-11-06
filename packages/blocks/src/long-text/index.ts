// packages/blocks — `long-text` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { LongTextEditor } from "./editor";
import { LongTextRender } from "./render";
import {
  LongTextAnswer,
  LongTextProps,
  longTextDefaultProps,
  validateLongText,
} from "./schema";

export const longTextBlock: BlockDef<LongTextProps, LongTextAnswer> = {
  kind: "long-text",
  family: "question",
  label: "Long text",
  icon: "align-left",
  propsSchema: LongTextProps,
  defaultProps: longTextDefaultProps,
  answerSchema: LongTextAnswer,
  validate: validateLongText,
  Editor: LongTextEditor,
  Render: LongTextRender,
};

registerBlock(longTextBlock);
