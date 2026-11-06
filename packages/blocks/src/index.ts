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

// --- T21 image adapter seam (T16 conformance surface) ------------------------
export { Img } from "./shared/img";
export { ImageAssetRefSchema, resolveImgProps } from "./shared/img";
export type { ImageAssetRef, ImgProps } from "./shared/img";

// --- T21 embed protocol (form-embed parent side; spec §10.2 shapes) ----------
export {
  FF_COMPLETE,
  FF_HEIGHT,
  attachEmbedEventListeners,
  dispatchEmbedMessage,
  isCompleteMessage,
  isHeightMessage,
  postToEmbedParent,
} from "./shared/embed-protocol";
export type { EmbedEventHandlers, FFChildMessage, FFCompleteMessage, FFHeightMessage } from "./shared/embed-protocol";

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

// --- T21 content blocks -------------------------------------------------------
export { galleryBlock } from "./gallery";
export { GalleryLayout, GalleryProps, galleryDefaultProps } from "./gallery/schema";
export { GalleryEditor } from "./gallery/editor";
export { GalleryRender } from "./gallery/render";

export { videoBlock } from "./video";
export { VideoProps, videoDefaultProps } from "./video/schema";
export { VideoEditor } from "./video/editor";
export { VideoRender } from "./video/render";
export { VIDEO_HOST_ALLOWLIST, isAllowedVideoUrl, toEmbedUrl, videoEmbedHost } from "./video/url";

export { testimonialsBlock } from "./testimonials";
export { TestimonialItem, TestimonialsProps, testimonialsDefaultProps } from "./testimonials/schema";
export { TestimonialsEditor } from "./testimonials/editor";
export { TestimonialsRender } from "./testimonials/render";

export { faqBlock } from "./faq";
export { FaqItem, FaqProps, faqDefaultProps } from "./faq/schema";
export { FaqEditor } from "./faq/editor";
export { FaqRender } from "./faq/render";

export { pricingBlock } from "./pricing";
export { PricingCta, PricingProps, PricingTier, pricingDefaultProps } from "./pricing/schema";
export { PricingEditor } from "./pricing/editor";
export { PricingRender } from "./pricing/render";

export { projectsBlock } from "./projects";
export { ProjectItem, ProjectsProps, projectsDefaultProps } from "./projects/schema";
export { ProjectsEditor } from "./projects/editor";
export { ProjectsRender } from "./projects/render";

export { contactLinksBlock } from "./contact-links";
export {
  ContactLink,
  ContactLinkType,
  ContactLinksProps,
  contactLinksDefaultProps,
} from "./contact-links/schema";
export { ContactLinksEditor } from "./contact-links/editor";
export { ContactLinksRender } from "./contact-links/render";

// --- T21 layout blocks --------------------------------------------------------
export { sectionBlock } from "./section";
export { SectionPadding, SectionProps, sectionDefaultProps } from "./section/schema";
export { SectionEditor } from "./section/editor";
export { SectionRender } from "./section/render";
export { resolveSectionBackground } from "./section/background";

export { columnsBlock } from "./columns";
export { ColumnsCount, ColumnsProps, columnsDefaultProps } from "./columns/schema";
export { ColumnsEditor } from "./columns/editor";
export { ColumnsRender } from "./columns/render";

export { multiQuestionPageBlock } from "./multi-question-page";
export {
  MultiQuestionPageAnswer,
  MultiQuestionPageProps,
  childAnswerOf,
  multiQuestionPageDefaultProps,
  validateChildAnswers,
} from "./multi-question-page/schema";
export { MultiQuestionPageEditor } from "./multi-question-page/editor";
export { MultiQuestionPageRender } from "./multi-question-page/render";

// --- T21 action blocks --------------------------------------------------------
export { formEmbedBlock } from "./form-embed";
export { DOCUMENT_ID_PATTERN, FormEmbedProps, embedFrameSrc, formEmbedDefaultProps } from "./form-embed/schema";
export { FormEmbedEditor } from "./form-embed/editor";
export { FormEmbedRender } from "./form-embed/render";
