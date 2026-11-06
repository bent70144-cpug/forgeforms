// Tests for rule draft ↔ op mapping (T20). The ops asserted here are the
// exact §8 wire shapes T07's PATCH endpoint must accept (TODO(merge) note in
// rules.ts) — keep these literals in sync with the tracker's merge checklist.

import { describe, expect, it } from "vitest";
import type { Rule } from "../bridge";
import {
  draftFromRule,
  fallbackTaken,
  formatOperandRef,
  newRuleDraft,
  npsScenarioRules,
  parseOperandRef,
  removeRuleOp,
  ruleFromDraft,
  rulesForScope,
  upsertRuleOp,
} from "./rules";

describe("operand refs", () => {
  it("formats and parses @block/@var/@hidden refs", () => {
    expect(formatOperandRef("block", "b1")).toBe("@block:b1");
    expect(parseOperandRef("@block:b1")).toEqual({ source: "block", ref: "b1" });
    expect(parseOperandRef("@hidden:utm_source")).toEqual({ source: "hidden", ref: "utm_source" });
    expect(parseOperandRef("@var:score")).toEqual({ source: "var", ref: "score" });
    expect(parseOperandRef("b1")).toBeNull();
    expect(parseOperandRef("@bogus:b1")).toBeNull();
  });
});

describe("ruleFromDraft", () => {
  it("builds the canonical NPS rule pair from drafts", () => {
    const ifDraft = {
      id: "rule_a",
      scope: "q_nps",
      conditions: [{ key: "c1", source: "block" as const, ref: "q_nps", op: "lte" as const, right: "6" }],
      actions: [{ key: "a1", kind: "goto" as const, target: "end:end_b" }],
      isFallback: false,
    };
    const rule = ruleFromDraft(ifDraft);
    expect(rule).toEqual({
      id: "rule_a",
      scope: "q_nps",
      when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
      then: [{ type: "goto", target: "end:end_b" }],
      isFallback: false,
    });
  });

  it("coerces numeric strings to numbers for eq (nps answers are numbers)", () => {
    const rule = ruleFromDraft({
      id: "r",
      scope: "q_nps",
      conditions: [{ key: "c", source: "block", ref: "q_nps", op: "eq", right: " 10 " }],
      actions: [],
      isFallback: false,
    });
    expect(rule.when[0]?.right).toBe(10);
  });

  it("drops the right-hand value for isEmpty and keeps strings otherwise", () => {
    const rule = ruleFromDraft({
      id: "r",
      scope: "q1",
      conditions: [
        { key: "c1", source: "block", ref: "q1", op: "isEmpty", right: "" },
        { key: "c2", source: "hidden", ref: "utm_source", op: "eq", right: "twitter" },
      ],
      actions: [{ key: "a", kind: "set", var: "score", value: "42" }],
      isFallback: false,
    });
    expect(rule.when[0]).toEqual({ left: "@block:q1", op: "isEmpty" });
    expect("right" in (rule.when[0] ?? {})).toBe(false);
    expect(rule.when[1]).toEqual({ left: "@hidden:utm_source", op: "eq", right: "twitter" });
    expect(rule.then).toEqual([{ type: "set", var: "score", value: "42" }]);
  });

  it("fallback rules serialize with an empty when", () => {
    const rule = ruleFromDraft({
      id: "r",
      scope: "q1",
      conditions: [{ key: "c", source: "block", ref: "q1", op: "eq", right: "x" }],
      actions: [{ key: "a", kind: "goto", target: "end:e1" }],
      isFallback: true,
    });
    expect(rule.when).toEqual([]);
    expect(rule.isFallback).toBe(true);
  });

  it("drops empty goto/set actions instead of persisting junk", () => {
    const rule = ruleFromDraft({
      id: "r",
      scope: "q1",
      conditions: [],
      actions: [
        { key: "a1", kind: "goto", target: "  " },
        { key: "a2", kind: "set", var: "", value: "1" },
        { key: "a3", kind: "goto", target: "end:e1" },
      ],
      isFallback: false,
    });
    expect(rule.then).toEqual([{ type: "goto", target: "end:e1" }]);
  });
});

describe("draftFromRule", () => {
  it("round-trips a stored rule through the draft model", () => {
    const stored: Rule = {
      id: "rule_nps_detractor",
      scope: "q_nps",
      when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
      then: [{ type: "goto", target: "end:end_b" }],
      isFallback: false,
    };
    const draft = draftFromRule(stored);
    expect(draft.conditions[0]).toMatchObject({ source: "block", ref: "q_nps", op: "lte", right: "6" });
    expect(draft.actions[0]).toMatchObject({ kind: "goto", target: "end:end_b" });
    expect(ruleFromDraft(draft)).toEqual(stored);
  });
});

describe("ops (spec §8 vocabulary)", () => {
  it("upsertRuleOp emits { op: 'rule.upsert', rule } verbatim", () => {
    const draft = newRuleDraft("q_nps");
    const op = upsertRuleOp(draft);
    expect(op.op).toBe("rule.upsert");
    expect(op.rule.id).toBe(draft.id);
    expect(op.rule.scope).toBe("q_nps");
  });

  it("removeRuleOp emits { op: 'rule.remove', id } verbatim", () => {
    expect(removeRuleOp("rule_1")).toEqual({ op: "rule.remove", id: "rule_1" });
  });
});

describe("scope queries + fallback uniqueness", () => {
  const rules = npsScenarioRules("q_nps", "end_a", "end_b");

  it("separates non-fallback rules from the scope fallback", () => {
    const { rules: own, fallback } = rulesForScope(rules, "q_nps");
    expect(own.map((r) => r.id)).toEqual(["rule_nps_detractor"]);
    expect(fallback?.id).toBe("rule_nps_otherwise");
  });

  it("returns nothing for unknown scopes", () => {
    const { rules: own, fallback } = rulesForScope(rules, "q_other");
    expect(own).toEqual([]);
    expect(fallback).toBeNull();
  });

  it("detects a taken fallback slot, excluding a given rule id", () => {
    expect(fallbackTaken(rules, "q_nps")).toBe(true);
    expect(fallbackTaken(rules, "q_nps", "rule_nps_otherwise")).toBe(false);
    expect(fallbackTaken(rules, "q_other")).toBe(false);
  });
});

describe("npsScenarioRules", () => {
  it("produces the exact §7 rule literals for 'If NPS ≤ 6 go to ending B, otherwise ending A'", () => {
    expect(npsScenarioRules("q_nps", "end_a", "end_b")).toEqual([
      {
        id: "rule_nps_detractor",
        scope: "q_nps",
        when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
        then: [{ type: "goto", target: "end:end_b" }],
        isFallback: false,
      },
      {
        id: "rule_nps_otherwise",
        scope: "q_nps",
        when: [],
        then: [{ type: "goto", target: "end:end_a" }],
        isFallback: true,
      },
    ]);
  });
});
