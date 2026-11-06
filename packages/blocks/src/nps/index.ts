// packages/blocks — `nps` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { NpsEditor } from "./editor";
import { NpsRender } from "./render";
import { NpsAnswer, NpsProps, npsDefaultProps, validateNps } from "./schema";

export const npsBlock: BlockDef<NpsProps, NpsAnswer> = {
  kind: "nps",
  family: "question",
  label: "NPS",
  icon: "gauge",
  propsSchema: NpsProps,
  defaultProps: npsDefaultProps,
  answerSchema: NpsAnswer,
  validate: validateNps,
  Editor: NpsEditor,
  Render: NpsRender,
};

registerBlock(npsBlock);
