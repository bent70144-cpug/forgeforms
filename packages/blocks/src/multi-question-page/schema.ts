// packages/blocks — `multi-question-page` props + answer schema (spec §7.2
// layout block: children = question blocks; answer value = map of child
// answers keyed by child block id).
//
// SPEC-NOTE (T21): §7.2 classifies this block as *Layout* while also giving it
// an answer value ("map of child answers"). The registry (§7.1, T06) forbids
// `answerSchema` on non-question blocks, so the definition registers without
// one and the answer schema is exported here (`MultiQuestionPageAnswer`) for
// renderers/ingest to apply explicitly, alongside `validateChildAnswers` which
// validates a child-answer map against the registered child question kinds.
// OWNED BY T21 (issue #21).
import { z } from "zod";
import type { Block } from "@formforge/schema";
import { getBlockDef } from "../registry";

export const MultiQuestionPageProps = z.strictObject({});

export type MultiQuestionPageProps = z.infer<typeof MultiQuestionPageProps>;

/** `{ [childBlockId]: childAnswer }` — spec §7.2 "map of child answers". */
export const MultiQuestionPageAnswer = z.record(z.string(), z.unknown());

export type MultiQuestionPageAnswer = z.infer<typeof MultiQuestionPageAnswer>;

export const multiQuestionPageDefaultProps = (): MultiQuestionPageProps => ({});

/**
 * Validate a stored child-answer map against the registered child kinds.
 * Unanswered children (missing keys) are allowed — requiredness is enforced by
 * the flow renderer/ingest with the child's own props. Returns an error
 * message or null.
 */
export function validateChildAnswers(children: readonly Block[], answers: unknown): string | null {
  const parsed = MultiQuestionPageAnswer.safeParse(answers);
  if (!parsed.success) {
    return "Answer value must be a map of child block ids to child answers";
  }
  for (const child of children) {
    const def = getBlockDef(child.kind);
    if (def === undefined || def.answerSchema === undefined) continue; // unknown / non-question child
    const value = parsed.data[child.id];
    if (value === undefined) continue; // unanswered
    if (!def.answerSchema.safeParse(value).success) {
      return `Answer for child block "${child.id}" does not satisfy the "${child.kind}" answer schema`;
    }
  }
  return null;
}

/** Read one child's answer out of the map (renderer helper). */
export function childAnswerOf(answers: MultiQuestionPageAnswer, childId: string): unknown {
  return answers[childId];
}
