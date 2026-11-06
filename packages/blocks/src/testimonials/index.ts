// packages/blocks — `testimonials` block definition; registers at import time.
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { TestimonialsEditor } from "./editor";
import { TestimonialsRender } from "./render";
import { TestimonialsProps, testimonialsDefaultProps } from "./schema";

export const testimonialsBlock: BlockDef<TestimonialsProps> = {
  kind: "testimonials",
  family: "content",
  label: "Testimonials",
  icon: "quote",
  propsSchema: TestimonialsProps,
  defaultProps: testimonialsDefaultProps,
  Editor: TestimonialsEditor,
  Render: TestimonialsRender,
};

registerBlock(testimonialsBlock);
