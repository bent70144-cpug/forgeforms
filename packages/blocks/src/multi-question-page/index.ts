// packages/blocks — `multi-question-page` block definition; registers at
// import time (§7.1). Layout family; answer schema is exported from ./schema
// (see the SPEC-NOTE there for the §7.1/§7.2 tension).
// OWNED BY T21 (issue #21).
import { registerBlock, type BlockDef } from "../registry";
import { MultiQuestionPageEditor } from "./editor";
import { MultiQuestionPageRender } from "./render";
import { MultiQuestionPageProps, multiQuestionPageDefaultProps } from "./schema";

export const multiQuestionPageBlock: BlockDef<MultiQuestionPageProps> = {
  kind: "multi-question-page",
  family: "layout",
  label: "Multi-question page",
  icon: "layout-list",
  propsSchema: MultiQuestionPageProps,
  defaultProps: multiQuestionPageDefaultProps,
  Editor: MultiQuestionPageEditor,
  Render: MultiQuestionPageRender,
};

registerBlock(multiQuestionPageBlock);
