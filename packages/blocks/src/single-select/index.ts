// packages/blocks — `single-select` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { SingleSelectEditor } from "./editor";
import { SingleSelectRender } from "./render";
import {
  SingleSelectAnswer,
  SingleSelectProps,
  singleSelectDefaultProps,
  validateSingleSelect,
} from "./schema";

export const singleSelectBlock: BlockDef<SingleSelectProps, SingleSelectAnswer> = {
  kind: "single-select",
  family: "question",
  label: "Single select",
  icon: "circle-dot",
  propsSchema: SingleSelectProps,
  defaultProps: singleSelectDefaultProps,
  answerSchema: SingleSelectAnswer,
  validate: validateSingleSelect,
  Editor: SingleSelectEditor,
  Render: SingleSelectRender,
};

registerBlock(singleSelectBlock);
