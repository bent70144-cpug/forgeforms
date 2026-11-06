// packages/blocks — `multi-question-page` builder editor (settings panel).
// The children are managed in the builder's Blocks tree (T08), so the settings
// panel only surfaces guidance + counts what the host app passes in.
import type { FC } from "react";
import type { EditorProps } from "../registry";
import type { MultiQuestionPageProps } from "./schema";

export const MultiQuestionPageEditor: FC<EditorProps<MultiQuestionPageProps>> = () => (
  <div className="ff-editor ff-editor--multi-question-page" data-kind="multi-question-page">
    <p className="ff-editor__hint">
      Several questions on one page. Add question blocks as children from the Blocks tree.
    </p>
  </div>
);
