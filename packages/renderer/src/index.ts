// @formforge/renderer — public renderer bundles (spec §2).
// T11 (issue #11) owns src/scroll/, T12 (issue #12) owns src/conversational/.
//
// Public surface:
//  - ScrollRenderer + section parts: scroll plane for pages/portfolios (server-only).
//  - getPublishedSnapshot: snapshot reader (INTEGRATION-DEBT — placeholder until T10,
//    see src/bridge.ts for the one-line swap).
//  - buildPageMetadata / classifySnapshotError: pure helpers for the /p/[slug] route.

export {
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
} from "./bridge";

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
