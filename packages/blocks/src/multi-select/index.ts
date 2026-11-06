// packages/blocks — `multi-select` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { MultiSelectEditor } from "./editor";
import { MultiSelectRender } from "./render";
import {
  MultiSelectAnswer,
  MultiSelectProps,
  multiSelectDefaultProps,
  validateMultiSelect,
} from "./schema";

export const multiSelectBlock: BlockDef<MultiSelectProps, MultiSelectAnswer> = {
  kind: "multi-select",
  family: "question",
  label: "Multi select",
  icon: "list-checks",
  propsSchema: MultiSelectProps,
  defaultProps: multiSelectDefaultProps,
  answerSchema: MultiSelectAnswer,
  validate: validateMultiSelect,
  Editor: MultiSelectEditor,
  Render: MultiSelectRender,
};

registerBlock(multiSelectBlock);
