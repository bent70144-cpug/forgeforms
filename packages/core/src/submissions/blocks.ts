// packages/core/src/submissions/blocks.ts
// Block-tree walking + per-answer validation against the published snapshot's
// question blocks (spec §7.1/§10.3: "ingest validates every answer against
// the block's answerSchema + validate").

import type { Block, Snapshot } from "../bridge";
import type { AnswerInput, BlockInfo, BlockRegistry, ValidationDetail } from "./types";

export type QuestionNode = {
  blockId: string;
  kind: string;
  props: Record<string, unknown>;
  info: BlockInfo;
};

/**
 * Pre-order walk of the block tree collecting question blocks (layout and
 * unknown kinds are recursed into so nested questions are found). Registry
 * lookups decide "is this a question" — content blocks never store answers
 * (spec §7.1).
 */
export function buildQuestionIndex(
  snapshot: Snapshot,
  registry: BlockRegistry,
): Map<string, QuestionNode> {
  const index = new Map<string, QuestionNode>();
  const visit = (blocks: Block[]): void => {
    for (const block of blocks) {
      const info = registry.get(block.kind);
      if (info?.family === "question") {
        index.set(block.id, { blockId: block.id, kind: block.kind, props: block.props, info });
      }
      if (block.children?.length) visit(block.children);
    }
  };
  visit(snapshot.blocks);
  return index;
}

export function firstQuestionBlockId(
  snapshot: Snapshot,
  registry: BlockRegistry,
): string | null {
  for (const block of snapshot.blocks) {
    const found = findFirstQuestion(block, registry);
    if (found) return found;
  }
  return null;
}

function findFirstQuestion(block: Block, registry: BlockRegistry): string | null {
  const info = registry.get(block.kind);
  if (info?.family === "question") return block.id;
  for (const child of block.children ?? []) {
    const found = findFirstQuestion(child, registry);
    if (found) return found;
  }
  return null;
}

export type ParsedAnswer = { blockId: string; value: unknown; clientTs?: string };

/**
 * Validate the request's answers against the snapshot's question blocks:
 * - unknown blockId → field-level VALIDATION detail on `answers[i].blockId`;
 * - null/undefined values are skipped (partial saves must be allowed);
 * - otherwise the block's answerSchema (shape) and `validate` (props-dependent
 *   rules) must both accept the value, else `answers[i].value` detail (§4).
 * clientTs, when present, must parse as ISO datetime.
 */
export function validateAnswers(
  snapshot: Snapshot,
  registry: BlockRegistry,
  answers: AnswerInput[],
): { ok: true; parsed: ParsedAnswer[] } | { ok: false; error: ValidationDetail[] } {
  const index = buildQuestionIndex(snapshot, registry);
  const details: ValidationDetail[] = [];
  const parsed: ParsedAnswer[] = [];

  answers.forEach((answer, i) => {
    if (typeof answer?.blockId !== "string" || answer.blockId === "") {
      details.push({ path: `answers[${i}].blockId`, message: "blockId is required" });
      return;
    }
    if (answer.clientTs !== undefined && Number.isNaN(Date.parse(answer.clientTs))) {
      details.push({ path: `answers[${i}].clientTs`, message: "clientTs must be an ISO datetime" });
      return;
    }
    const question = index.get(answer.blockId);
    if (!question) {
      details.push({
        path: `answers[${i}].blockId`,
        message: `Unknown question block "${String(answer.blockId)}"`,
      });
      return;
    }
    if (answer.value === undefined || answer.value === null) return; // nothing to store
    if (question.info.answerSchema) {
      const res = question.info.answerSchema.safeParse(answer.value);
      if (!res.success) {
        const message =
          res.error.issues.map((issue) => issue.message).join("; ") || "Invalid answer value";
        details.push({ path: `answers[${i}].value`, message });
        return;
      }
      answer = { ...answer, value: res.data };
    }
    const customError = question.info.validate?.(answer.value, question.props);
    if (customError) {
      details.push({ path: `answers[${i}].value`, message: customError });
      return;
    }
    parsed.push({ blockId: answer.blockId, value: answer.value, clientTs: answer.clientTs });
  });

  if (details.length > 0) return { ok: false, error: details };
  return { ok: true, parsed };
}

export function isRequired(props: Record<string, unknown>): boolean {
  return props.required === true;
}

export function isEmptyAnswer(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}
