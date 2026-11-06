// @formforge/core/logic — public API (spec §9).
// Pure function library, shared verbatim by the client renderer and the
// server (ingest validation, snapshot build). Zero I/O, zero framework
// imports, no node-only APIs.
//
// INTEGRATION-DEBT: rule/block input types come from src/bridge.ts until
// T06 (@formforge/schema) lands — see bridge.ts for the one-file swap.

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
  Operand,
  RouteMap,
  RouteNode,
  Routing,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionOp,
} from "./types.ts";
