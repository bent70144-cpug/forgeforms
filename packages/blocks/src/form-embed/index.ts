// packages/blocks — `form-embed` block definition; registers at import time.
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { FormEmbedEditor } from "./editor";
import { FormEmbedRender } from "./render";
import { FormEmbedProps, formEmbedDefaultProps } from "./schema";

export const formEmbedBlock: BlockDef<FormEmbedProps> = {
  kind: "form-embed",
  family: "action",
  label: "Form embed",
  icon: "puzzle",
  propsSchema: FormEmbedProps,
  defaultProps: formEmbedDefaultProps,
  Editor: FormEmbedEditor,
  Render: FormEmbedRender,
};

registerBlock(formEmbedBlock);
