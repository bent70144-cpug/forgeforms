// packages/blocks — `faq` block definition; registers at import time (§7.1).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { FaqEditor } from "./editor";
import { FaqRender } from "./render";
import { FaqProps, faqDefaultProps } from "./schema";

export const faqBlock: BlockDef<FaqProps> = {
  kind: "faq",
  family: "content",
  label: "FAQ",
  icon: "help-circle",
  propsSchema: FaqProps,
  defaultProps: faqDefaultProps,
  Editor: FaqEditor,
  Render: FaqRender,
};

registerBlock(faqBlock);
