// packages/blocks — `dropdown` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { DropdownEditor } from "./editor";
import { DropdownRender } from "./render";
import {
  DropdownAnswer,
  DropdownProps,
  dropdownDefaultProps,
  validateDropdown,
} from "./schema";

export const dropdownBlock: BlockDef<DropdownProps, DropdownAnswer> = {
  kind: "dropdown",
  family: "question",
  label: "Dropdown",
  icon: "chevron-down-square",
  propsSchema: DropdownProps,
  defaultProps: dropdownDefaultProps,
  answerSchema: DropdownAnswer,
  validate: validateDropdown,
  Editor: DropdownEditor,
  Render: DropdownRender,
};

registerBlock(dropdownBlock);
