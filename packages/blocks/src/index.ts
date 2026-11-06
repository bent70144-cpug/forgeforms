// @formforge/blocks — block definitions: schema + editor + renderer per kind
// (spec §7.1). OWNED BY T06 (issue #6): registry + hero, short-text, button;
// T09 adds the remaining MVP question kinds (email, number, long-text,
// single/multi-select, dropdown, rating, nps) by creating `src/<kind>/` and
// importing it here. file-upload intentionally lands with T16 (uploads).
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
export { Option, OptionList, findOption, knownOptionIds, shuffledOptions } from "./shared/option-list";
export { paramsFromSearch, prefillFor, rawParam } from "./shared/prefill";
export type { UrlParams } from "./shared/prefill";
export {
  CanvasPreview,
  GenericQuestionFields,
  OptionsFields,
  OptionalNumberField,
  QuestionShell,
} from "./shared/question-editor-kit";
export type { GenericQuestionPatch } from "./shared/question-editor-kit";

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

// --- Question kinds (T09, spec §7.2; file-upload → T16) ----------------------
export { emailBlock } from "./email";
export { EmailAnswer, EmailProps, emailDefaultProps, prefillEmail, validateEmail } from "./email/schema";
export { EmailEditor } from "./email/editor";
export { EmailRender } from "./email/render";

export { numberBlock } from "./number";
export { NumberAnswer, NumberProps, numberDefaultProps, prefillNumber, validateNumber } from "./number/schema";
export { NumberEditor } from "./number/editor";
export { NumberRender } from "./number/render";

export { longTextBlock } from "./long-text";
export {
  LongTextAnswer,
  LongTextProps,
  longTextDefaultProps,
  prefillLongText,
  validateLongText,
} from "./long-text/schema";
export { LongTextEditor } from "./long-text/editor";
export { LongTextRender } from "./long-text/render";

export { singleSelectBlock } from "./single-select";
export {
  SingleSelectAnswer,
  SingleSelectProps,
  prefillSingleSelect,
  singleSelectDefaultOptions,
  singleSelectDefaultProps,
  validateSingleSelect,
} from "./single-select/schema";
export { SingleSelectEditor } from "./single-select/editor";
export { SingleSelectRender } from "./single-select/render";

export { multiSelectBlock } from "./multi-select";
export {
  MultiSelectAnswer,
  MultiSelectProps,
  multiSelectDefaultProps,
  prefillMultiSelect,
  validateMultiSelect,
} from "./multi-select/schema";
export { MultiSelectEditor } from "./multi-select/editor";
export { MultiSelectRender } from "./multi-select/render";

export { dropdownBlock } from "./dropdown";
export {
  DropdownAnswer,
  DropdownProps,
  dropdownDefaultProps,
  prefillDropdown,
  validateDropdown,
} from "./dropdown/schema";
export { DropdownEditor } from "./dropdown/editor";
export { DropdownRender } from "./dropdown/render";

export { ratingBlock } from "./rating";
export {
  RatingAnswer,
  RatingIcon,
  RatingProps,
  prefillRating,
  ratingDefaultProps,
  ratingScale,
  validateRating,
} from "./rating/schema";
export { RatingEditor } from "./rating/editor";
export { RatingRender } from "./rating/render";

export { npsBlock } from "./nps";
export {
  NpsAnswer,
  NpsProps,
  clampNps,
  npsDefaultProps,
  prefillNps,
  validateNps,
} from "./nps/schema";
export { NpsEditor } from "./nps/editor";
export { NpsRender } from "./nps/render";
