// packages/blocks — `button` block definition; registers at import time (§7.1).
// OWNED BY T06 (issue #6).
import { registerBlock, type BlockDef } from "../registry";
import { ButtonEditor } from "./editor";
import { ButtonRender } from "./render";
import { ButtonProps, buttonDefaultProps } from "./schema";

export const buttonBlock: BlockDef<ButtonProps> = {
  kind: "button",
  family: "action",
  label: "Button",
  icon: "mouse-pointer-click",
  propsSchema: ButtonProps,
  defaultProps: buttonDefaultProps,
  Editor: ButtonEditor,
  Render: ButtonRender,
};

registerBlock(buttonBlock);
