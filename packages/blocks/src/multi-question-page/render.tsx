// packages/blocks — `multi-question-page` public renderer (server-safe).
//
// Renders the child blocks it is given (BlockView passes them via `children`).
// SPEC-NOTE (T21): distributing the child-answer map to each child input is
// step-level logic owned by the document renderers (T10 conversational /
// T12 scroll); this registry-level render is the layout shell + passthrough.
import type { FC } from "react";
import type { RenderProps } from "../registry";
import type { MultiQuestionPageProps } from "./schema";

export const MultiQuestionPageRender: FC<RenderProps<MultiQuestionPageProps>> = ({ children }) => (
  <div className="ff-multi-question-page" data-block-kind="multi-question-page">
    {children}
  </div>
);
