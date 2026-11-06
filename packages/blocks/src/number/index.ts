// packages/blocks — `number` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { NumberEditor } from "./editor";
import { NumberRender } from "./render";
import { NumberAnswer, NumberProps, numberDefaultProps, validateNumber } from "./schema";

export const numberBlock: BlockDef<NumberProps, NumberAnswer> = {
  kind: "number",
  family: "question",
  label: "Number",
  icon: "hash",
  propsSchema: NumberProps,
  defaultProps: numberDefaultProps,
  answerSchema: NumberAnswer,
  validate: validateNumber,
  Editor: NumberEditor,
  Render: NumberRender,
};

registerBlock(numberBlock);
