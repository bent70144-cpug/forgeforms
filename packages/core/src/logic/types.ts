// Logic engine public types (spec §9). Pure data — safe to ship to the client.

// ---------------------------------------------------------------------------
// Structural input types (spec §7 `Rule` / `Block` shapes the engine consumes).
// ISSUE #30: these lived in the retired core `bridge.ts`; they are defined here
// until the engine fully adopts @formforge/schema's Zod-inferred types.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Operands
// ---------------------------------------------------------------------------

/** Parsed operand reference: `@block:<id>` | `@var:<name>` | `@hidden:<name>`. */
export interface Operand {
  readonly source: "block" | "var" | "hidden";
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Compiled program
// ---------------------------------------------------------------------------

/**
 * A condition with its operand references pre-parsed at compile time.
 * If `ref` or `op` is `null` the input was malformed and the condition
 * deterministically evaluates to `false` (never throws).
 */
export interface CompiledCondition {
  readonly ref: Operand | null;
  readonly op: RuleConditionOp | null;
  /** Literal right-hand side (ignored by `isEmpty`). */
  readonly right: unknown;
  /** Set when `right` was itself an operand reference (e.g. `"@block:b2"`). */
  readonly rightRef: Operand | null;
}

/** Pre-parsed action. Malformed actions compile to `noop` (ignored). */
export type CompiledAction =
  | { readonly kind: "goto"; readonly target: string }
  | { readonly kind: "set"; readonly name: string; readonly value: unknown }
  | { readonly kind: "noop" };

/** A rule with operands pre-parsed. Produced only by `compile()`. */
export interface CompiledRule {
  readonly id: string;
  readonly scope: string;
  readonly isFallback: boolean;
  readonly conditions: readonly CompiledCondition[];
  readonly actions: readonly CompiledAction[];
}

/**
 * Per-scope routing node, keyed by blockId in `Routing.scopes`
 * (plus the synthetic `"start"` scope). Matches the snapshot's
 * `routing: Record<string, RouteNode>` (spec §8).
 */
export interface RouteNode {
  /**
   * Next block in document (depth-first) order, or `end:<firstEndingId>`
   * after the last block. Also used as the fallback when a rule's `goto`
   * target is unknown at runtime.
   */
  readonly defaultNext: string;
  /** Rules scoped here, in rule-array order (fallback rules excluded). */
  readonly rules: readonly CompiledRule[];
  /** The scope's fallback rule, if any (at most one — see `multiple_fallbacks`). */
  readonly fallback?: CompiledRule;
}

/**
 * Flat, serializable routing map — exactly the snapshot's
 * `routing: Record<string, RouteNode>` field (spec §8). `evaluate()` accepts
 * this shape directly so the renderer can feed it the snapshot without
 * re-compiling.
 */
export type RouteMap = Record<string, RouteNode>;

/** Diagnosable lint violations reported by `compile()` / `lint()`. */
export type DiagnosticCode =
  | "dangling_goto" // goto target is neither a known blockId nor `end:<endingId>`
  | "unknown_scope" // rule scope is neither a known blockId nor "start"
  | "duplicate_rule_id"
  | "multiple_fallbacks" // more than one isFallback rule per scope
  | "fallback_with_when" // isFallback rule with non-empty `when` (warning)
  | "cycle_no_exit" // goto cycle with no exit (cannot ever reach `end:*`)
  | "unreachable_block" // block not reachable from start (warning)
  | "malformed_operand" // `left` is not `@block|@var|@hidden:<name>`
  | "unknown_block_ref" // `@block:<id>` pointing at a block that does not exist
  | "malformed_condition" // condition is not a well-formed object / unknown op
  | "malformed_action" // action is not a well-formed goto/set
  | "invalid_set_var" // `set` action with missing/empty var name
  | "duplicate_block_id"; // two blocks share an id

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: "error" | "warning";
  /** Rule the violation belongs to, when applicable. */
  readonly ruleId?: string;
  /** Scope block / offending block id, when applicable. */
  readonly blockId?: string;
  readonly message: string;
}

/**
 * Compiled logic program (spec §9 `compile(rules, blocks) → Routing`).
 * Deterministic, JSON-serializable, carries its lint diagnostics so
 * `compile()` "reports each lint violation class with rule id + block id"
 * (issue #13). `evaluate()` also accepts the flat `RouteMap` snapshot shape.
 */
export interface Routing {
  readonly kind: "routing";
  readonly version: 1;
  /** blockId → RouteNode, plus the synthetic `"start"` scope. Null-prototype. */
  readonly scopes: RouteMap;
  /** Ending ids known at compile time (may be empty when not supplied). */
  readonly endings: readonly string[];
  /** Lint diagnostics, deterministically sorted. */
  readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

/**
 * Evaluation context (spec §9). `urlParams` is an extension (see SPEC-NOTE in
 * evaluate.ts): `@hidden:<name>` falls back to it so URL-prefilled values work
 * without seeding `hidden` by hand.
 */
export interface EvaluateCtx {
  /** Block answers keyed by blockId (raw; normalized per spec §9 before comparing). */
  readonly answers: Record<string, unknown>;
  /** Calculated variables (`set` action targets), keyed by name. */
  readonly variables: Record<string, unknown>;
  /** Hidden fields keyed by name. */
  readonly hidden: Record<string, unknown>;
  /** Scope to evaluate: a blockId or `"start"`. */
  readonly currentBlockId: string;
  /** Optional URL params; consulted for `@hidden` lookups as a fallback. */
  readonly urlParams?: Record<string, unknown>;
}

export interface EvaluateResult {
  /** Next blockId, or `end:<endingId>` after the last block / on a goto. */
  readonly nextBlockId: string | `end:${string}`;
  /** Copy of the variables after any `set` actions ran. */
  readonly variables: Record<string, unknown>;
}

/**
 * Dependency-injection type for the engine's `evaluate` (spec §9). Accepts a
 * compiled `Routing`, the flat snapshot `RouteMap`, or nothing (degrades to
 * the documented fallbacks). ISSUE #30: replaces the legacy strict alias that
 * lived in the retired core `bridge.ts`.
 */
export type LogicEvaluate = (
  routing: Routing | RouteMap | null | undefined,
  ctx: Partial<EvaluateCtx> | null | undefined,
) => EvaluateResult;
