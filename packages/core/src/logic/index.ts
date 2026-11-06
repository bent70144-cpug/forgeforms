// @formforge/core/logic — public API (spec §9).
// Pure function library, shared verbatim by the client renderer and the
// server (ingest validation, snapshot build). Zero I/O, zero framework
// imports, no node-only APIs.
//
// ISSUE #30: the structural rule/block input types are defined in types.ts
// (they previously came from the retired src/bridge.ts).

export { compile, lint, routeMap, isRoutingShape } from "./compile.ts";
export { evaluate } from "./evaluate.ts";

export type {
  Block,
  CompiledAction,
  CompiledCondition,
  CompiledRule,
  Diagnostic,
  DiagnosticCode,
  EvaluateCtx,
  EvaluateResult,
  LogicEvaluate,
  Operand,
  RouteMap,
  RouteNode,
  Routing,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionOp,
} from "./types.ts";
