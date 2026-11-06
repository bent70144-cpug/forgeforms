// @formforge/core — templates module (W1-22, issue #22).
//
// SPEC-NOTE: the module contract (spec §3) says each core module exposes only its
// `index.ts`. The package root `src/index.ts` is owned by T02 (shared kernel), so
// this module is published as the subpath `@formforge/core/templates` (see
// packages/core/package.json `exports`). When T02 lands, the integrator may add
// `export * from "./templates"` to the root index and deprecate the subpath.
export { listTemplates, getTemplate, instantiateTemplate } from "./service";
export type { InstantiateOptions } from "./service";
export type {
  Template,
  TemplateMeta,
  TemplateSummary,
  TemplateCategory,
  TemplateDefinition,
  NewDocumentPayload,
  InstantiateCtx,
  Result,
  AppError,
} from "./types";

// Re-exports for consumers that render template bodies (gallery, preview, embeds).
// INTEGRATION-DEBT: awaiting T06 — these come from the local bridge until
// @formforge/schema is mergeable (issue #30 retired src/bridge.ts).
export type {
  DocumentBody,
  Block,
  Theme,
  Rule,
  Ending,
  DocumentBodyInput,
  BlockInput,
  ThemeInput,
  RuleInput,
  EndingInput,
} from "./schema";
export { TEMPLATE_BLOCK_KINDS } from "./schema";
export type { TemplateBlockKind } from "./schema";
