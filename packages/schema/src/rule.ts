// packages/schema — conditional logic rules (spec §7).
// OWNED BY T06 (issue #6). The runtime engine itself lives in packages/core (T13).
import { z } from "zod";

export const RuleCondition = z.object({
  left: z.string(), // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
  op: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "isEmpty",
    "matches",
  ]),
  right: z.unknown().optional(),
});

export const RuleAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), target: z.string() }), // blockId | "end:<endingId>"
  z.object({ type: z.literal("set"), var: z.string(), value: z.unknown() }),
]);

export const Rule = z.object({
  id: z.string(),
  scope: z.string(), // blockId this rule runs after, or "start"
  when: z.array(RuleCondition),
  then: z.array(RuleAction),
  isFallback: z.boolean().default(false), // "in all other cases"
});

export type RuleCondition = z.infer<typeof RuleCondition>;
export type RuleAction = z.infer<typeof RuleAction>;
export type Rule = z.infer<typeof Rule>;
