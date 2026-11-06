// packages/blocks — `hero` block definition; registers at import time (§7.1).
// OWNED BY T06 (issue #6).
import { registerBlock, type BlockDef } from "../registry";
import { HeroEditor } from "./editor";
import { HeroRender } from "./render";
import { HeroProps, heroDefaultProps } from "./schema";

export const heroBlock: BlockDef<HeroProps> = {
  kind: "hero",
  family: "content",
  label: "Hero",
  icon: "layout-template",
  propsSchema: HeroProps,
  defaultProps: heroDefaultProps,
  Editor: HeroEditor,
  Render: HeroRender,
};

registerBlock(heroBlock);
