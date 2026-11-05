// @formforge/schema — Zod schemas: blocks, documents, rules (spec §7).
// OWNED BY T06 (issue #6). T25 adds src/api/ as new files only; it will be
// exposed as a sub-path export ("./api") — keep runtime imports here untouched.
//
// Zod is the single source of truth for block, document and form schemas.
//
// NOTE: the schema consts below are exported together with their same-name
// types via declaration merging (`export { DocumentBody }` exports both the
// Zod schema value and the inferred `DocumentBody` type).

export { Block, BlockBase, cloneBlockWithNewId } from "./block";

export { DEFAULT_THEME, Theme } from "./theme";

export { Rule, RuleAction, RuleCondition } from "./rule";

export {
  DocumentBody,
  DocumentSettings,
  Ending,
  createEmptyDocumentBody,
} from "./document";
export type { DocumentType } from "./document";

export { documentIssuesFromZodError, formatZodPath } from "./errors";
export type { DocumentIssue } from "./errors";

export { validateDocumentBody } from "./validate";
export type { KindSchemaMap, ValidateDocumentResult } from "./validate";
