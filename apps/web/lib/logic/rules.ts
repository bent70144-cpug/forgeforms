// Rule drafting model for the logic builder drawer (spec §14.1.4: "IF
// conditions with AND, THEN goto/set, 'in all other cases'").
//
// Converts between the drawer's editor-friendly drafts and the §7 `Rule`
// wire shape, and emits the spec §8 ops vocabulary consumed by
// `PATCH /api/v1/documents/:id` (rule.upsert / rule.remove).
//
// TODO(merge): align with T07 ops schema — the op discriminants below follow
// spec §8 verbatim; T07's Zod schema for PATCH ops is being built in parallel
// and must accept exactly these shapes (apps/web/lib/builder/ops.ts already
// applies them client-side).

import type { Rule, RuleAction, RuleCondition } from "../bridge";

/** Condition operator union (spec §7 `Rule.when.op`). */
export type RuleConditionOp = RuleCondition["op"];
import { newId } from "../builder/id";
import type { Op } from "../builder/ops";

/** All condition ops supported by the engine (spec §7 `Rule.when.op`). */
export const CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "isEmpty",
  "matches",
] as const satisfies readonly RuleConditionOp[];

export const OP_LABELS: Record<RuleConditionOp, string> = {
  eq: "equals",
  neq: "does not equal",
  gt: "is greater than",
  gte: "is greater or equal",
  lt: "is less than",
  lte: "is less or equal",
  contains: "contains",
  isEmpty: "is empty",
  matches: "matches regex",
};

export type ConditionSource = "block" | "var" | "hidden";

/** Editor-friendly condition: operand split into source + ref name. */
export type ConditionDraft = {
  key: string;
  source: ConditionSource;
  /** Block id / variable name / hidden field name (without the `@…:` prefix). */
  ref: string;
  op: RuleConditionOp;
  /** Raw right-hand side; empty string for isEmpty. */
  right: string;
};

export type ActionDraft =
  | { key: string; kind: "goto"; target: string }
  | { key: string; kind: "set"; var: string; value: string };

export type RuleDraft = {
  id: string;
  scope: string;
  conditions: ConditionDraft[];
  actions: ActionDraft[];
  isFallback: boolean;
};

// ---------------------------------------------------------------------------
// Operand refs ("@block:<id>" | "@var:<name>" | "@hidden:<name>")
// ---------------------------------------------------------------------------

export function formatOperandRef(source: ConditionSource, ref: string): string {
  return `@${source}:${ref}`;
}

export function parseOperandRef(raw: string): { source: ConditionSource; ref: string } | null {
  const match = /^@(block|var|hidden):(.+)$/.exec(raw);
  if (!match) return null;
  return { source: match[1] as ConditionSource, ref: match[2] ?? "" };
}

// ---------------------------------------------------------------------------
// Draft ↔ Rule
// ---------------------------------------------------------------------------

/** Right-hand-side coercion: ordering ops need numbers; isEmpty drops the value. */
function coerceRight(op: RuleConditionOp, right: string): unknown {
  if (op === "isEmpty") return undefined;
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const n = Number(right);
    return right.trim() !== "" && Number.isFinite(n) ? n : undefined;
  }
  // eq/neq/contains/matches: numeric strings must compare numerically against
  // number answers (nps/rating), so "6" → 6; other strings stay strings.
  if (right.trim() !== "" && /^-?\d+(\.\d+)?$/.test(right.trim())) return Number(right.trim());
  return right;
}

export function ruleFromDraft(draft: RuleDraft): Rule {
  const when: RuleCondition[] = draft.isFallback
    ? []
    : draft.conditions
        .filter((c) => c.ref.trim() !== "" || c.op === "isEmpty")
        .map((c) => {
          const condition: RuleCondition = {
            left: formatOperandRef(c.source, c.ref),
            op: c.op,
          };
          const right = coerceRight(c.op, c.right);
          if (right !== undefined) condition.right = right;
          return condition;
        });
  const then: RuleAction[] = draft.actions
    .map((action) => {
      if (action.kind === "goto") {
        return action.target.trim() !== ""
          ? ({ type: "goto", target: action.target } as RuleAction)
          : null;
      }
      return action.var.trim() !== ""
        ? ({ type: "set", var: action.var, value: action.value } as RuleAction)
        : null;
    })
    .filter((a): a is RuleAction => a !== null);
  return {
    id: draft.id,
    scope: draft.scope,
    when,
    then,
    isFallback: draft.isFallback,
  };
}

export function draftFromRule(rule: Rule): RuleDraft {
  const conditions: ConditionDraft[] = (rule.when ?? []).map((c) => {
    const parsed = parseOperandRef(c.left);
    return {
      key: newId(),
      source: parsed?.source ?? "block",
      ref: parsed?.ref ?? "",
      op: c.op,
      right: c.right === undefined || c.right === null ? "" : String(c.right),
    };
  });
  const actions: ActionDraft[] = (rule.then ?? []).map((a) =>
    a.type === "goto"
      ? { key: newId(), kind: "goto" as const, target: a.target }
      : { key: newId(), kind: "set" as const, var: a.var, value: a.value === null || a.value === undefined ? "" : String(a.value) },
  );
  return {
    id: rule.id,
    scope: rule.scope,
    conditions,
    actions,
    isFallback: rule.isFallback === true,
  };
}

export function emptyConditionDraft(): ConditionDraft {
  return { key: newId(), source: "block", ref: "", op: "eq", right: "" };
}

export function emptyGotoDraft(): ActionDraft {
  return { key: newId(), kind: "goto", target: "" };
}

export function newRuleDraft(scope: string): RuleDraft {
  return {
    id: `rule_${newId()}`,
    scope,
    conditions: [emptyConditionDraft()],
    actions: [emptyGotoDraft()],
    isFallback: false,
  };
}

// ---------------------------------------------------------------------------
// Ops (spec §8 vocabulary)
// ---------------------------------------------------------------------------

/** The single op that persists a rule edit (upsert semantics by rule id). */
export function upsertRuleOp(draft: RuleDraft): Extract<Op, { op: "rule.upsert" }> {
  return { op: "rule.upsert", rule: ruleFromDraft(draft) };
}

export function removeRuleOp(ruleId: string): Extract<Op, { op: "rule.remove" }> {
  return { op: "rule.remove", id: ruleId };
}

// ---------------------------------------------------------------------------
// Scope queries + fallback uniqueness ("in all other cases")
// ---------------------------------------------------------------------------

/** Non-fallback rules first (array order), then the scope's fallback, if any. */
export function rulesForScope(rules: readonly Rule[], scope: string): { rules: Rule[]; fallback: Rule | null } {
  const own: Rule[] = [];
  let fallback: Rule | null = null;
  for (const rule of rules) {
    if (rule.scope !== scope) continue;
    if (rule.isFallback === true) fallback ??= rule;
    else own.push(rule);
  }
  return { rules: own, fallback };
}

/** True when another rule (excluding `exceptId`) already holds the fallback slot. */
export function fallbackTaken(rules: readonly Rule[], scope: string, exceptId?: string): boolean {
  return rules.some(
    (rule) =>
      rule.scope === scope && rule.isFallback === true && rule.id !== exceptId,
  );
}

/**
 * "If NPS ≤ 6 go to ending B, otherwise ending A" in one op pair — the spec's
 * canonical example, kept executable so the builder + preview + runtime tests
 * share one literal.
 */
export function npsScenarioRules(npsBlockId: string, endingAId: string, endingBId: string): Rule[] {
  return [
    {
      id: "rule_nps_detractor",
      scope: npsBlockId,
      when: [{ left: `@block:${npsBlockId}`, op: "lte", right: 6 }],
      then: [{ type: "goto", target: `end:${endingBId}` }],
      isFallback: false,
    },
    {
      id: "rule_nps_otherwise",
      scope: npsBlockId,
      when: [],
      then: [{ type: "goto", target: `end:${endingAId}` }],
      isFallback: true,
    },
  ];
}
