// @formforge/renderer — public renderer bundles (spec §2).
// T11 (issue #11) owns src/scroll/, T12 (issue #12) owns src/conversational/.
//
// Public surface:
//  - ScrollRenderer + section parts: scroll plane for pages/portfolios (server-only).
//  - ConversationalRenderer + flow machine: form plane (client, ≤120KB budget).
//  - getPublishedSnapshot + configureSnapshotReader: injectable snapshot reader
//    (issue #30: placeholder default until the host app configures the real one).
//  - buildPageMetadata / classifySnapshotError: pure helpers for the /p/[slug] route.

export {
  configureSnapshotReader,
  getPublishedSnapshot,
  type AppError,
  type GetPublishedSnapshot,
  type Result,
  type Snapshot,
  type SnapshotBlock,
  type SnapshotEnding,
  type SnapshotSeo,
  type SnapshotSettings,
  type SnapshotType,
} from "./snapshot";

export type {
  Block,
  DocumentBody,
  Ending,
  QuestionKind,
  Rule,
  Theme,
} from "./document-model";
export { isInstantAnswer, isQuestionKind } from "./document-model";

export { ScrollRenderer, type ScrollRendererProps } from "./scroll/ScrollRenderer";
export { BlockSection } from "./scroll/sections/BlockSection";
export { GoneView } from "./scroll/sections/GoneView";

export {
  buildPageMetadata,
  buildUnavailableMetadata,
  type BuildPageMetadataOptions,
  type PageMetadata,
} from "./scroll/metadata";
export { classifySnapshotError, type SnapshotErrorKind } from "./scroll/errors";

export {
  DEFAULT_THEME_VARS,
  normalizeCssVars,
  type NormalizeCssVarsOptions,
} from "./scroll/theme";

export {
  ConversationalRenderer,
  createInitialState,
  createMachineReducer,
  createFetchIngestClient,
  createMockIngestClient,
  IngestError,
  themeToCssVars,
  validateAnswer,
} from "./conversational/index";
export type {
  ConversationalRendererProps,
  IngestClient,
  MachineState,
} from "./conversational/index";
