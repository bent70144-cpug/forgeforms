// @formforge/core — domain modules (spec §2/§3).
//
// OWNED BY T02 (issue #2): the shared kernel lives in src/shared/ and is
// re-exported here. Later tickets add their own module folders alongside and
// export them through this package root as well (spec §3).
export * from "./shared/ctx.ts";
export * from "./shared/result.ts";
export * from "./shared/errors.ts";
export * from "./shared/ids.ts";
export * from "./shared/logger.ts";
export * from "./shared/env.ts";
export * from "./shared/audit.ts";

// T10 (issue #10): publish pipeline — versions, snapshots, unpublish→410.
export * from "./documents/index.ts";

// T13 (issue #13): logic engine. Routing/RouteNode intentionally NOT re-exported
// at the root — T10's documents module owns those names at the root surface;
// logic consumers import them from "@formforge/core/logic".
export {
  compile,
  lint,
  routeMap,
  isRoutingShape,
  evaluate,
} from "./logic/index.ts";
export type {
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionOp,
  Operand,
  CompiledRule,
  CompiledCondition,
  CompiledAction,
  Diagnostic,
  DiagnosticCode,
  EvaluateCtx,
  EvaluateResult,
} from "./logic/index.ts";

// T14 (issue #14): submissions ingest services.
export * from "./submissions/index.ts";
