// @formforge/blocks — block definitions: schema + editor + renderer per kind
// (spec §7.1). OWNED BY T06 (issue #6): registry + hero, short-text, button;
// T09/T21 add more kinds by creating `src/<kind>/` and importing it here.
//
// Importing this module builds the registry at import time (spec §7.1).
//
// NOTE: props schemas (e.g. `HeroProps`) are exported together with their
// same-name types via declaration merging — one import gives both.

export {
  BlockRegistrationError,
  blockKinds,
  getBlockDef,
  hasBlockDef,
  listBlockDefs,
  registeredKindSchemas,
  registerBlock,
} from "./registry";
export type {
  AnyBlockDef,
  BlockDef,
  BlockFamily,
  EditorProps,
  RenderProps,
} from "./registry";

export { BlockView } from "./view";
export type { BlockViewProps } from "./view";

export { parseDocument } from "./parse";

export { safeHref } from "./shared/safe-href";
export { QuestionPropsBase } from "./shared/question-props";

// --- Block kinds (import = register) ----------------------------------------
export { heroBlock } from "./hero";
export { HeroProps, heroDefaultProps } from "./hero/schema";
export { HeroEditor } from "./hero/editor";
export { HeroRender } from "./hero/render";

export { shortTextBlock } from "./short-text";
export {
  ShortTextAnswer,
  ShortTextProps,
  shortTextDefaultProps,
  validateShortText,
} from "./short-text/schema";
export { ShortTextEditor } from "./short-text/editor";
export { ShortTextRender } from "./short-text/render";

export { buttonBlock } from "./button";
export { ButtonProps, ButtonStyle, buttonDefaultProps } from "./button/schema";
export { ButtonEditor } from "./button/editor";
export { ButtonRender } from "./button/render";
