// compile() — turns raw rules + blocks into a validated, block-indexed
// Routing program (spec §9) and reports lint violations as diagnostics.
// Pure, deterministic, isomorphic, zero I/O.
//
// SPEC-NOTEs (deviations/extensions, all backwards-compatible with spec §9):
// 1. `compile(rules, blocks)` takes an OPTIONAL third argument `endings`:
//    the default next after the last block is `end:<first ending>` (spec §9),
//    which cannot be resolved without the document's ending ids. When omitted,
//    endings default to `[]` and the default becomes the opaque `end:`.
// 2. Document order is a depth-first walk of top-level blocks (children after
//    their parent), because core cannot know which `kind`s are "question"
//    blocks (that registry lives in packages/blocks). Renderers that need a
//    question-only flow pass the filtered block list.
// 3. `Routing` embeds `diagnostics` so compile() satisfies issue #13
//    ("compile() reports each lint violation class with rule id + block id");
//    `lint()` is the same array exposed standalone, and `routeMap()` projects
//    the flat `Record<string, RouteNode>` shape the snapshot stores (spec §8).

import { parseOperand, looksLikeOperand } from "./operands.js";
import type {
  Block,
  CompiledAction,
  CompiledCondition,
  CompiledRule,
  Diagnostic,
  DiagnosticCode,
  Operand,
  RouteMap,
  RouteNode,
  Routing,
  Rule,
  RuleConditionOp,
} from "./types.js";

const CONDITION_OPS: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "isEmpty",
  "matches",
]);

const START_SCOPE = "start";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compiles rules + blocks into a Routing program (spec §9) and lints it.
 * Never throws: malformed inputs produce diagnostics, not exceptions.
 *
 * @param rules   raw rules (as stored in `DocumentBody.logic.rules`)
 * @param blocks  top-level blocks in document order (children included in the walk)
 * @param endings ending ids (spec §8); needed to resolve `end:<first>` defaults
 */
export function compile(
  rules: readonly Rule[] | null | undefined,
  blocks: readonly Block[] | null | undefined,
  endings: readonly string[] | null | undefined = [],
): Routing {
  const ruleList = asArray(rules);
  const blockList = asArray(blocks);
  const endingList = dedupe(asArray(endings).filter((e): e is string => typeof e === "string"));

  const ctx: CompileCtx = {
    diagnostics: [],
    allIds: new Set(),
    nodes: [], // [start, ...blocks in DFS order]
    endingSet: new Set(endingList),
    fallbackCounts: new Map(),
    ruleIdsSeen: new Set(),
  };

  collectBlocks(blockList, ctx);
  compileRules(ruleList, ctx);
  const graph = buildGraph(ctx);
  lintGraph(graph, ctx);

  return {
    kind: "routing",
    version: 1,
    scopes: freezeScopes(ctx.nodes),
    endings: endingList,
    diagnostics: sortDiagnostics(ctx.diagnostics),
  };
}

/**
 * Standalone lint (spec §9 "compile-time lint"). Same diagnostics that
 * `compile()` embeds in the Routing — one shared implementation.
 */
export function lint(
  rules: readonly Rule[] | null | undefined,
  blocks: readonly Block[] | null | undefined,
  endings: readonly string[] | null | undefined = [],
): readonly Diagnostic[] {
  return compile(rules, blocks, endings).diagnostics;
}

/**
 * Projects a Routing (or an already-flat map) to the snapshot's
 * `routing: Record<string, RouteNode>` shape (spec §8). Null-prototype.
 */
export function routeMap(routing: Routing | RouteMap | null | undefined): RouteMap {
  const source = isRoutingShape(routing) ? routing.scopes : routing;
  const out: Record<string, RouteNode> = Object.create(null) as Record<string, RouteNode>;
  if (source === null || typeof source !== "object") return out;
  for (const [key, value] of Object.entries(source)) {
    if (isRouteNodeShape(value)) out[key] = value;
  }
  return out;
}

/** Structural guard: does this look like a full `Routing` (vs a flat `RouteMap`)? */
export function isRoutingShape(value: unknown): value is Routing {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<Routing>;
  return v.scopes !== null && typeof v.scopes === "object" && !Array.isArray(v.scopes);
}

/** Structural guard for a single serialized route node. */
function isRouteNodeShape(value: unknown): value is RouteNode {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { defaultNext?: unknown }).defaultNext === "string"
  );
}

// ---------------------------------------------------------------------------
// Internal compile context
// ---------------------------------------------------------------------------

interface MutableNode {
  readonly id: string;
  defaultNext: string;
  readonly rules: CompiledRule[];
  fallback: CompiledRule | undefined;
}

interface CompileCtx {
  diagnostics: Diagnostic[];
  /** Every block id (top-level + children), first occurrence wins. */
  allIds: Set<string>;
  /** nodes[0] is always the synthetic "start" scope. */
  nodes: MutableNode[];
  endingSet: ReadonlySet<string>;
  fallbackCounts: Map<string, number>;
  ruleIdsSeen: Set<string>;
}

function asArray<T>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function diag(
  ctx: CompileCtx,
  code: DiagnosticCode,
  severity: "error" | "warning",
  message: string,
  ids: { ruleId?: string; blockId?: string } = {},
): void {
  ctx.diagnostics.push({ code, severity, ...ids, message });
}

// ---------------------------------------------------------------------------
// Block walk (depth-first, document order)
// ---------------------------------------------------------------------------

function collectBlocks(blocks: readonly unknown[], ctx: CompileCtx): void {
  ctx.nodes.push({
    id: START_SCOPE,
    defaultNext: "",
    rules: [],
    fallback: undefined,
  });
  walkBlocks(blocks, ctx);
  recomputeDefaults(ctx);
}

/** Depth-first pre-order walk; ids collected for reference/scope validation. */
function walkBlocks(blocks: readonly unknown[], ctx: CompileCtx): void {
  for (const block of blocks) {
    if (block === null || typeof block !== "object") continue; // SPEC-NOTE 1: T06 validates upstream
    const id = (block as Block).id;
    if (typeof id !== "string" || id === "") continue;
    if (!ctx.allIds.has(id)) {
      ctx.allIds.add(id);
      ctx.nodes.push({ id, defaultNext: "", rules: [], fallback: undefined });
    } else {
      // Duplicate id (top-level or nested): first occurrence defines the flow node.
      diag(ctx, "duplicate_block_id", "error", `duplicate block id "${id}"`, { blockId: id });
    }
    const children = (block as Block).children;
    if (Array.isArray(children)) walkBlocks(children, ctx);
  }
}

function recomputeDefaults(ctx: CompileCtx): void {
  const end = `end:${ctx.endingSet.values().next().value ?? ""}`;
  for (let i = 0; i < ctx.nodes.length; i++) {
    const node = ctx.nodes[i];
    if (node === undefined) continue;
    const next = ctx.nodes[i + 1];
    node.defaultNext = next === undefined ? end : next.id;
  }
}

// ---------------------------------------------------------------------------
// Rule compilation
// ---------------------------------------------------------------------------

function compileRules(rules: readonly unknown[], ctx: CompileCtx): void {
  for (const rule of rules) {
    if (rule === null || typeof rule !== "object") continue; // SPEC-NOTE 1: T06 validates upstream
    const r = rule as Rule;
    const ruleId = typeof r.id === "string" ? r.id : "";

    if (ruleId !== "" && ctx.ruleIdsSeen.has(ruleId)) {
      diag(ctx, "duplicate_rule_id", "error", `duplicate rule id "${ruleId}"`, { ruleId });
    }
    if (ruleId !== "") ctx.ruleIdsSeen.add(ruleId);

    const scope = typeof r.scope === "string" ? r.scope : "";
    if (scope !== START_SCOPE && !ctx.allIds.has(scope)) {
      diag(
        ctx,
        "unknown_scope",
        "error",
        `rule is scoped to "${scope || "<missing>"}" which is not a block id or "start"`,
        { ruleId, blockId: scope },
      );
      continue;
    }
    const node = requireNode(ctx, scope);
    if (node === undefined) continue;

    const isFallback = (r as { isFallback?: unknown }).isFallback === true;
    const when = Array.isArray(r.when) ? r.when : [];
    const then = Array.isArray(r.then) ? r.then : [];

    const conditions = when.map((c) => compileCondition(c, ctx, ruleId, scope));
    const actions = then.map((a) => compileAction(a, ctx, ruleId, scope));

    if (isFallback) {
      const count = ctx.fallbackCounts.get(scope) ?? 0;
      ctx.fallbackCounts.set(scope, count + 1);
      if (count === 0) {
        if (conditions.length > 0) {
          diag(
            ctx,
            "fallback_with_when",
            "warning",
            `fallback rule "${ruleId}" has conditions; they are ignored (fallback runs whenever nothing else matched)`,
            { ruleId, blockId: scope },
          );
        }
        node.fallback = { id: ruleId, scope, isFallback: true, conditions, actions };
      } else {
        diag(
          ctx,
          "multiple_fallbacks",
          "error",
          `scope "${scope}" has more than one fallback rule; only the first ("${
            node.fallback?.id ?? "<unknown>"
          }") runs`,
          { ruleId, blockId: scope },
        );
      }
      continue;
    }
    node.rules.push({ id: ruleId, scope, isFallback: false, conditions, actions });
  }
}

function requireNode(ctx: CompileCtx, id: string): MutableNode | undefined {
  return ctx.nodes.find((n) => n.id === id);
}

function compileCondition(
  raw: unknown,
  ctx: CompileCtx,
  ruleId: string,
  scope: string,
): CompiledCondition {
  if (raw === null || typeof raw !== "object") {
    diag(ctx, "malformed_condition", "error", "condition is not an object", { ruleId, blockId: scope });
    return { ref: null, op: null, right: undefined, rightRef: null };
  }
  const c = raw as { left?: unknown; op?: unknown; right?: unknown };
  const op =
    typeof c.op === "string" && CONDITION_OPS.has(c.op) ? (c.op as RuleConditionOp) : null;
  if (op === null) {
    diag(ctx, "malformed_condition", "error", `unknown or missing condition op`, {
      ruleId,
      blockId: scope,
    });
    return { ref: null, op: null, right: c.right, rightRef: null };
  }
  const ref = parseOperand(c.left);
  if (ref === null) {
    diag(
      ctx,
      "malformed_operand",
      "error",
      `condition left "${String(c.left)}" is not @block:<id>, @var:<name> or @hidden:<name>`,
      { ruleId, blockId: scope },
    );
    return { ref: null, op, right: c.right, rightRef: null };
  }
  if (ref.source === "block" && !ctx.allIds.has(ref.name)) {
    diag(
      ctx,
      "unknown_block_ref",
      "error",
      `condition references "@block:${ref.name}" but no such block exists`,
      { ruleId, blockId: scope },
    );
  }
  const rightRef = looksLikeOperand(c.right) ? parseOperand(c.right) : null;
  if (c.right !== undefined && looksLikeOperand(c.right) && rightRef === null) {
    diag(ctx, "malformed_operand", "error", `condition right "${String(c.right)}" is malformed`, {
      ruleId,
      blockId: scope,
    });
  }
  return { ref, op, right: c.right, rightRef };
}

function compileAction(
  raw: unknown,
  ctx: CompileCtx,
  ruleId: string,
  scope: string,
): CompiledAction {
  if (raw === null || typeof raw !== "object") {
    diag(ctx, "malformed_action", "error", "action is not an object", { ruleId, blockId: scope });
    return { kind: "noop" };
  }
  const a = raw as { type?: unknown; target?: unknown; var?: unknown; value?: unknown };
  if (a.type === "goto") {
    if (typeof a.target !== "string" || a.target === "") {
      diag(ctx, "malformed_action", "error", "goto action without a target", { ruleId, blockId: scope });
      return { kind: "noop" };
    }
    if (!isValidGotoTarget(a.target, ctx)) {
      diag(
        ctx,
        "dangling_goto",
        "error",
        `goto target "${a.target}" is neither a block id nor a known "end:<endingId>"`,
        { ruleId, blockId: scope },
      );
    }
    return { kind: "goto", target: a.target };
  }
  if (a.type === "set") {
    if (typeof a.var !== "string" || a.var === "") {
      diag(ctx, "invalid_set_var", "error", "set action without a variable name", {
        ruleId,
        blockId: scope,
      });
      return { kind: "noop" };
    }
    return { kind: "set", name: a.var, value: a.value };
  }
  diag(ctx, "malformed_action", "error", `unknown action type "${String(a.type)}"`, {
    ruleId,
    blockId: scope,
  });
  return { kind: "noop" };
}

function isValidGotoTarget(target: string, ctx: CompileCtx): boolean {
  if (target === START_SCOPE) return true;
  if (ctx.allIds.has(target)) return true;
  if (target.startsWith("end:")) {
    // Without supplied endings, any `end:*` target is accepted (cannot verify).
    return ctx.endingSet.size === 0 || ctx.endingSet.has(target.slice(4));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Graph analysis: reachability (unreachable_block) + cycles with no exit
// ---------------------------------------------------------------------------

interface Graph {
  /** Deterministic node order: start, then DFS blocks. */
  order: string[];
  /** Normal (block→block) edges, deduped, in deterministic order. */
  adj: Map<string, string[]>;
  /** Node has a possible edge to some `end:*` target. */
  exits: Set<string>;
}

/**
 * Computes the *possible* runtime transitions of each scope, honoring rule
 * priority: the first unconditional matcher (empty `when`, or the fallback)
 * always wins, so rules after it can never run and the scope's default next
 * only applies when the winner has no valid `goto`. This is what makes
 * "fallback goto cycles" detectable — their default edges are unreachable.
 */
function buildGraph(ctx: CompileCtx): Graph {
  const adj = new Map<string, string[]>();
  const exits = new Set<string>();
  const order = ctx.nodes.map((n) => n.id);

  for (const node of ctx.nodes) {
    const seq = allRules(node); // non-fallback rules in order, then fallback (if any)
    // Index of the first rule that is guaranteed to match: a non-fallback rule
    // with zero conditions, or the fallback itself (always evaluated last and
    // always matches, regardless of its (lint-flagged) conditions).
    let guaranteed = -1;
    for (let i = 0; i < seq.length; i++) {
      const isFallbackEntry = node.fallback !== undefined && i === seq.length - 1;
      const rule = seq[i];
      if (rule !== undefined && (isFallbackEntry || rule.conditions.length === 0)) {
        guaranteed = i;
        break;
      }
    }

    const edges = new Set<string>();
    let exit = false;
    let defaultPossible = guaranteed < 0; // may fall through all rules

    for (let i = 0; i < seq.length; i++) {
      if (guaranteed >= 0 && i > guaranteed) break; // shadowed — can never run
      const rule = seq[i];
      if (rule === undefined) continue;
      let hasValidGoto = false;
      for (const action of rule.actions) {
        if (action.kind !== "goto") continue;
        if (isValidGotoTarget(action.target, ctx)) {
          hasValidGoto = true;
          if (action.target.startsWith("end:")) {
            exit = true;
          } else {
            edges.add(action.target);
          }
        }
      }
      if (!hasValidGoto) defaultPossible = true; // rule matched but did not jump
    }

    if (defaultPossible) {
      if (node.defaultNext.startsWith("end:")) {
        exit = true;
      } else if (
        node.defaultNext !== "" &&
        (node.defaultNext === START_SCOPE || ctx.allIds.has(node.defaultNext))
      ) {
        edges.add(node.defaultNext);
      }
    }
    adj.set(node.id, [...edges]);
    if (exit) exits.add(node.id);
  }
  return { order, adj, exits };
}

function allRules(node: MutableNode): CompiledRule[] {
  return node.fallback === undefined ? [...node.rules] : [...node.rules, node.fallback];
}

function lintGraph(graph: Graph, ctx: CompileCtx): void {
  if (graph.order.length <= 1) return; // no blocks → nothing to lint

  const reachable = reachableFrom(graph, START_SCOPE);
  for (const id of graph.order) {
    if (id === START_SCOPE || reachable.has(id)) continue;
    diag(ctx, "unreachable_block", "warning", `block "${id}" is not reachable from the start`, {
      blockId: id,
    });
  }

  // Fixpoint: a node can exit if it (or any node it can reach in one normal
  // edge) can reach an `end:*` target. Nodes that cannot exit loop forever.
  const canExit = new Set(graph.exits);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of graph.order) {
      if (canExit.has(id)) continue;
      const edges = graph.adj.get(id) ?? [];
      if (edges.some((e) => canExit.has(e))) {
        canExit.add(id);
        changed = true;
      }
    }
  }

  // Tarjan SCC over the non-exiting subgraph; each SCC is a (or leads into a)
  // goto cycle with no exit.
  const stuck = graph.order.filter((id) => !canExit.has(id));
  if (stuck.length === 0) return;
  const stuckSet = new Set(stuck);
  const stuckAdj = new Map<string, string[]>();
  for (const id of stuck) {
    stuckAdj.set(
      id,
      (graph.adj.get(id) ?? []).filter((e) => !canExit.has(e) && stuckSet.has(e)),
    );
  }
  for (const scc of tarjanSCC(stuck, stuckAdj)) {
    const sorted = [...scc].sort((a, b) => graph.order.indexOf(a) - graph.order.indexOf(b));
    diag(
      ctx,
      "cycle_no_exit",
      "error",
      `goto cycle with no exit: ${sorted.map((id) => `"${id}"`).join(" → ")} can never reach an ending`,
      { blockId: sorted[0] },
    );
  }
}

function reachableFrom(graph: Graph, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of graph.adj.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Iterative Tarjan SCC (no recursion → safe for long documents). */
function tarjanSCC(nodes: readonly string[], adj: ReadonlyMap<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const call: Array<{ node: string; edgeIdx: number }> = [{ node: root, edgeIdx: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (call.length > 0) {
      const frame = call[call.length - 1];
      if (frame === undefined) break;
      const edges = adj.get(frame.node) ?? [];
      if (frame.edgeIdx < edges.length) {
        const next = edges[frame.edgeIdx];
        frame.edgeIdx += 1;
        if (next === undefined) continue;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          call.push({ node: next, edgeIdx: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(next) ?? 0));
        }
      } else {
        call.pop();
        const parent = call[call.length - 1];
        if (parent !== undefined) {
          low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
        }
        if (low.get(frame.node) === index.get(frame.node)) {
          const scc: string[] = [];
          for (;;) {
            const member = stack.pop();
            if (member === undefined) break;
            onStack.delete(member);
            scc.push(member);
            if (member === frame.node) break;
          }
          sccs.push(scc);
        }
      }
    }
  }
  return sccs;
}

// ---------------------------------------------------------------------------
// Assembly helpers
// ---------------------------------------------------------------------------

function freezeScopes(nodes: readonly MutableNode[]): RouteMap {
  const scopes = Object.create(null) as Record<string, RouteNode>;
  for (const node of nodes) {
    const out: RouteNode = {
      defaultNext: node.defaultNext,
      rules: node.rules,
      ...(node.fallback !== undefined ? { fallback: node.fallback } : {}),
    };
    scopes[node.id] = out;
  }
  return scopes;
}

function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const key = (d: Diagnostic) =>
      `${d.code}\u0000${d.blockId ?? ""}\u0000${d.ruleId ?? ""}\u0000${d.message}`;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
}
