// packages/blocks — `section` block definition; registers at import time (§7.1).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { SectionEditor } from "./editor";
import { SectionRender } from "./render";
import { SectionProps, sectionDefaultProps } from "./schema";

export const sectionBlock: BlockDef<SectionProps> = {
  kind: "section",
  family: "layout",
  label: "Section",
  icon: "square",
  propsSchema: SectionProps,
  defaultProps: sectionDefaultProps,
  Editor: SectionEditor,
  Render: SectionRender,
};

registerBlock(sectionBlock);
