// Logic canvas graph (spec §14.1.4): derives the React Flow canvas model from
// a DocumentBody — nodes = start, question blocks, endings; edges = default
// flow (document order), plus dashed edges for rule `goto` targets.
//
// Pure and React-free so the mapping is fully unit-testable; the React Flow
// component consumes `toFlowElements`. Lint errors come from T13's engine
// (`@formforge/core/logic`) so the builder shows exactly what publish gates on.

import { lint } from "@formforge/core/logic";
import type { Diagnostic } from "@formforge/core/logic";
import type { Block, DocumentBody, Rule } from "../bridge";
import { BLOCK_CATALOG } from "../builder/blockMeta";

export const START_NODE_ID = "start";

/** Canvas node id for an ending — identical to the `goto` target string (§7). */
export function endingNodeId(endingId: string): string {
  return `end:${endingId}`;
}

const FAMILY_BY_KIND = new Map(BLOCK_CATALOG.map((meta) => [meta.kind, meta.family]));

export function isQuestionBlock(block: Block): boolean {
  return FAMILY_BY_KIND.get(block.kind) === "question" && block.hidden !== true;
}

/** Display label for a canvas node (question label, ending title, or fallback). */
export function blockLabel(block: Block): string {
  for (const key of ["label", "title"] as const) {
    const value = block.props[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return block.id;
}

/** Depth-first question blocks in document order (layout children included). */
export function questionBlocks(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (!block || typeof block.id !== "string") continue;
      if (isQuestionBlock(block)) out.push(block);
      if (Array.isArray(block.children)) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

export type LogicNode = {
  /** Canvas node id: `"start"`, a blockId, or `end:<endingId>` (= goto target). */
  id: string;
  kind: "start" | "question" | "ending";
  label: string;
  /** Question kind, question nodes only. */
  questionKind?: string;
  /** Ending id, ending nodes only (without the `end:` prefix). */
  endingId?: string;
};

export type LogicEdge = {
  id: string;
  source: string;
  target: string;
  /** True for rule `goto` edges (dashed) as opposed to default-flow edges. */
  isRuleEdge: boolean;
  /** Rule id for rule edges. */
  ruleId?: string;
};

export type LogicGraph = {
  nodes: LogicNode[];
  /** Default-flow edges in document order, then rule edges. */
  edges: LogicEdge[];
  /** Question block ids in flow order (default-next traversal path). */
  order: string[];
};

const FALLBACK_ENDING_ID = "default";

/**
 * Builds the canvas graph. With no configured endings a virtual
 * `end:default` node is added so the default flow always terminates visibly.
 */
export function buildLogicGraph(body: DocumentBody): LogicGraph {
  const questions = questionBlocks(body.blocks ?? []);
  const endings = body.endings ?? [];

  const nodes: LogicNode[] = [
    { id: START_NODE_ID, kind: "start", label: "Start" },
    ...questions.map(
      (block): LogicNode => ({
        id: block.id,
        kind: "question",
        label: blockLabel(block),
        questionKind: block.kind,
      }),
    ),
    ...(endings.length > 0
      ? endings.map(
          (ending): LogicNode => ({
            id: endingNodeId(ending.id),
            kind: "ending",
            label: ending.title || ending.id,
            endingId: ending.id,
          }),
        )
      : [
          {
            id: endingNodeId(FALLBACK_ENDING_ID),
            kind: "ending" as const,
            label: "Default ending (built-in)",
            endingId: FALLBACK_ENDING_ID,
          },
        ]),
  ];

  const edges: LogicEdge[] = [];
  const flowTargets: string[] = questions.map((q) => q.id);
  if (questions.length > 0) {
    flowTargets.unshift(START_NODE_ID);
    const terminal =
      endings[0]?.id !== undefined ? endingNodeId(endings[0].id) : endingNodeId(FALLBACK_ENDING_ID);
    flowTargets.push(terminal);
  }
  for (let i = 0; i < flowTargets.length - 1; i++) {
    const source = flowTargets[i];
    const target = flowTargets[i + 1];
    if (source === undefined || target === undefined) continue;
    edges.push({ id: `flow:${source}->${target}`, source, target, isRuleEdge: false });
  }

  // Rule `goto` edges (dashed). Only resolvable targets — dangling ones are
  // surfaced as lint errors instead (see `logicLintErrors`).
  const known = new Set(nodes.map((n) => n.id));
  for (const rule of body.logic?.rules ?? []) {
    const source = rule.scope === "start" ? START_NODE_ID : rule.scope;
    if (!known.has(source)) continue;
    for (const action of rule.then ?? []) {
      if (action.type !== "goto") continue;
      if (!known.has(action.target)) continue;
      if (action.target === source) continue; // self-loops would clutter the canvas
      edges.push({
        id: `rule:${rule.id}:${source}->${action.target}`,
        source,
        target: action.target,
        isRuleEdge: true,
        ruleId: rule.id,
      });
    }
  }

  return { nodes, edges, order: questions.map((q) => q.id) };
}

/**
 * Error-severity lint diagnostics from the T13 engine — exactly what blocks
 * publish (spec §9 compile-time lint). Warnings are excluded.
 */
export function logicLintErrors(body: DocumentBody): Diagnostic[] {
  const diagnostics = lint(
    body.logic?.rules ?? [],
    body.blocks ?? [],
    (body.endings ?? []).map((e) => e.id),
  );
  return diagnostics.filter((d) => d.severity === "error");
}

/** True when the target does not resolve to a block id or a known ending. */
export function isDanglingTarget(target: string, body: DocumentBody): boolean {
  if (target === START_NODE_ID) return false;
  const allIds = new Set<string>();
  const collect = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block && typeof block.id === "string") allIds.add(block.id);
      if (Array.isArray(block.children)) collect(block.children);
    }
  };
  collect(body.blocks ?? []);
  if (allIds.has(target)) return false;
  if (target.startsWith("end:")) {
    const id = target.slice("end:".length);
    return !(body.endings ?? []).some((e) => e.id === id);
  }
  return true;
}

/** Rules that reference a dangling goto target, for UI + error messaging. */
export function rulesWithDanglingTargets(body: DocumentBody): Rule[] {
  return (body.logic?.rules ?? []).filter((rule) =>
    (rule.then ?? []).some(
      (action) => action.type === "goto" && isDanglingTarget(action.target, body),
    ),
  );
}
