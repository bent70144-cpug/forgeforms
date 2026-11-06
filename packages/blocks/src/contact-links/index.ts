// packages/blocks — `contact-links` block definition; registers at import time.
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { ContactLinksEditor } from "./editor";
import { ContactLinksRender } from "./render";
import { ContactLinksProps, contactLinksDefaultProps } from "./schema";

export const contactLinksBlock: BlockDef<ContactLinksProps> = {
  kind: "contact-links",
  family: "content",
  label: "Contact links",
  icon: "link",
  propsSchema: ContactLinksProps,
  defaultProps: contactLinksDefaultProps,
  Editor: ContactLinksEditor,
  Render: ContactLinksRender,
};

registerBlock(contactLinksBlock);
