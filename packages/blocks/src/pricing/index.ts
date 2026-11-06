// packages/blocks — `pricing` block definition; registers at import time (§7.1).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { PricingEditor } from "./editor";
import { PricingRender } from "./render";
import { PricingProps, pricingDefaultProps } from "./schema";

export const pricingBlock: BlockDef<PricingProps> = {
  kind: "pricing",
  family: "content",
  label: "Pricing",
  icon: "credit-card",
  propsSchema: PricingProps,
  defaultProps: pricingDefaultProps,
  Editor: PricingEditor,
  Render: PricingRender,
};

registerBlock(pricingBlock);
