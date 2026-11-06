// packages/blocks — `rating` block definition; registers at import time (§7.1).
// OWNED BY T09 (issue #9).
import { registerBlock, type BlockDef } from "../registry";
import { RatingEditor } from "./editor";
import { RatingRender } from "./render";
import { RatingAnswer, RatingProps, ratingDefaultProps, validateRating } from "./schema";

export const ratingBlock: BlockDef<RatingProps, RatingAnswer> = {
  kind: "rating",
  family: "question",
  label: "Rating",
  icon: "star",
  propsSchema: RatingProps,
  defaultProps: ratingDefaultProps,
  answerSchema: RatingAnswer,
  validate: validateRating,
  Editor: RatingEditor,
  Render: RatingRender,
};

registerBlock(ratingBlock);
