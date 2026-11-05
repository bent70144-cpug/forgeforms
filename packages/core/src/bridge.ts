// INTEGRATION-DEBT: awaiting T06
// Minimal structural types for the logic engine (spec §7/§9) until
// `@formforge/schema` publishes the real Zod schemas. This file is the ONLY
// place that defines rule/document shapes inside @formforge/core.
//
// When T06 lands, replace the definitions below with re-exports:
//   export type { Rule, RuleCondition, RuleConditionOp, RuleAction, Block } from "@formforge/schema";
// No other file under src/logic imports rule/block types from anywhere else,
// so integration is a one-file change.
//
// These are *structural* (duck-typed) types on purpose: the logic engine is a
// pure function library that must never throw on half-validated input
// (issue #13: "evaluate() never throws on malformed routing"). T06's Zod
// schemas remain the single source of truth at the document boundary.

/** Comparison operators supported by rule conditions (spec §7 `Rule.when`). */
export type RuleConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "isEmpty"
  | "matches";

/**
 * One condition of a rule. Conditions inside a rule are implicitly ANDed.
 * `left` is an operand reference: `@block:<id>` | `@var:<name>` | `@hidden:<name>`.
 */
export interface RuleCondition {
  left: string;
  op: RuleConditionOp;
  right?: unknown;
}

/** Actions a matching rule performs, in array order. */
export type RuleAction =
  | { type: "goto"; target: string } // blockId | `end:<endingId>`
  | { type: "set"; var: string; value: unknown };

/** A logic rule (spec §7 `Rule`). */
export interface Rule {
  id: string;
  /** blockId this rule runs after, or `"start"` for pre-first-block rules. */
  scope: string;
  when: RuleCondition[];
  then: RuleAction[];
  /** `"in all other cases"` rule: has empty `when`, runs only if nothing matched. */
  isFallback?: boolean;
}

/** Block document node (spec §7 `Block`). */
export interface Block {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[];
  hidden?: boolean;
}
