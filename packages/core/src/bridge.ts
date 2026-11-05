// INTEGRATION-DEBT (lead reconciliation): historically each ticket stubbed the
// kernel here. T02's real kernel now lives in src/shared/ — this file RE-EXPORTS
// it so every `../bridge` import resolves to the canonical declarations, and
// keeps ONLY the structural rule/block types the logic engine consumes until
// its callers fully migrate to @formforge/schema types (spec §7).
export * from "./shared/ctx.ts";
export * from "./shared/result.ts";
export * from "./shared/errors.ts";
export * from "./shared/ids.ts";
export type { ErrorDetail as AppErrorDetail } from "./shared/errors.ts";
import { AppError, type AppErrorCode, type ErrorDetail } from "./shared/errors.ts";

/** §4 error envelope from an AppError (kept for identity-module callers). */
export function errorBody(error: AppError): {
  error: { code: AppErrorCode; message: string; details: readonly ErrorDetail[] };
} {
  return error.toResponseBody();
}

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
