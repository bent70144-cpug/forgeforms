// evaluate() — runs a compiled Routing (or the snapshot's flat RouteMap) for
// one scope (spec §9). Pure, deterministic, isomorphic.
//
// SPEC-NOTEs:
// 1. `evaluate()` also accepts the flat `Record<string, RouteNode>` routing map
//    stored in snapshots (spec §8), not just the full `Routing` object — the
//    renderer should not have to re-compile. Detection is structural.
// 2. `ctx.urlParams` extends spec §9's ctx: `@hidden:<name>` falls back to URL
//    params so prefill links work without the server seeding `hidden` by hand.
//    `ctx.hidden` always wins when the key exists.
// 3. When a winning rule has several actions they run in order; each `goto`
//    overwrites the pending target (last goto wins) and every `set` applies.
// 4. evaluate() NEVER throws (issue #13): malformed programs, broken targets
//    and garbage ctx degrade to the documented fallbacks.

import { checkCondition } from "./conditions.js";
import { hasOwnKey, resolveOperand, type OperandEnv } from "./operands.js";
import { isRoutingShape } from "./compile.js";
import type { CompiledCondition, EvaluateCtx, EvaluateResult, RouteMap, Routing } from "./types.js";

const START_SCOPE = "start";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluate(
  routing: Routing | RouteMap | null | undefined,
  ctx: Partial<EvaluateCtx> | null | undefined,
): EvaluateResult {
  try {
    return evaluateUnsafe(routing, ctx);
  } catch {
    // Last-resort guard: evaluate must never throw, on any input.
    return safeResult(ctx);
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function evaluateUnsafe(
  routing: Routing | RouteMap | null | undefined,
  ctx: Partial<EvaluateCtx> | null | undefined,
): EvaluateResult {
  const currentId = ctx !== null && typeof ctx === "object" && typeof ctx.currentBlockId === "string"
    ? ctx.currentBlockId
    : "";
  const vars = newVarStore(ctx?.variables);
  const env = buildEnv(ctx);

  const scopes = getScopes(routing);
  if (scopes === null || currentId === "") {
    return { nextBlockId: currentId, variables: vars };
  }
  const node = getNode(scopes, currentId);
  if (node === null) {
    return { nextBlockId: currentId, variables: vars };
  }

  const endings = getEndings(routing);
  const firstMatch = firstMatchingRule(node.rules, env);
  const winner = firstMatch !== null ? firstMatch : node.fallback;

  let next = typeof node.defaultNext === "string" ? node.defaultNext : "";
  if (winner !== null) {
    for (const action of winner.actions) {
      if (action.kind === "set") {
        vars[action.name] = action.value;
      } else if (action.kind === "goto") {
        next = action.target;
      }
      // kind === "noop" → ignored
    }
  }

  return { nextBlockId: resolveTarget(next, node, scopes, endings, currentId), variables: vars };
}

/** Structural duck-type of a compiled route node (tolerates JSON round-trips). */
interface RuntimeNode {
  defaultNext: string;
  rules: RuntimeRule[];
  fallback: RuntimeRule | null;
}

interface RuntimeRule {
  conditions: readonly CompiledCondition[];
  actions: RuntimeAction[];
}

type RuntimeAction =
  | { kind: "goto"; target: string }
  | { kind: "set"; name: string; value: unknown }
  | { kind: "noop" };

function getScopes(routing: Routing | RouteMap | null | undefined): Record<string, unknown> | null {
  if (routing === null || typeof routing !== "object") return null;
  if (isRoutingShape(routing)) {
    return isPlainObject(routing.scopes) ? (routing.scopes as unknown as Record<string, unknown>) : null;
  }
  // Flat RouteMap (snapshot shape): every value should look like a RouteNode.
  const map = routing as unknown;
  if (!isPlainObject(map)) return null;
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length === 0) return null;
  const looksLikeMap = entries.every(([, v]) => v === null || typeof v !== "object" || isNodeLike(v));
  return looksLikeMap ? (map as Record<string, unknown>) : null;
}

function getNode(scopes: Record<string, unknown>, id: string): RuntimeNode | null {
  if (!hasOwnKey(scopes, id)) return null;
  const raw = scopes[id];
  if (!isNodeLike(raw)) return null;
  const rules = Array.isArray(raw.rules)
    ? raw.rules.filter(isRuleLike).map(normalizeRule)
    : [];
  const fallback = isRuleLike(raw.fallback) ? normalizeRule(raw.fallback) : null;
  return {
    defaultNext: typeof raw.defaultNext === "string" ? raw.defaultNext : "",
    rules,
    fallback,
  };
}

function isNodeLike(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    hasOwnKey(value, "defaultNext")
  );
}

function isRuleLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray((value as { conditions?: unknown }).conditions) && Array.isArray((value as { actions?: unknown }).actions);
}

function normalizeRule(raw: Record<string, unknown>): RuntimeRule {
  const conditions = (raw.conditions as unknown[]).map((c) => c as CompiledCondition);
  const actions = (raw.actions as unknown[]).map((a): RuntimeAction => {
    if (a === null || typeof a !== "object") return { kind: "noop" };
    const action = a as { kind?: unknown; target?: unknown; name?: unknown; value?: unknown };
    if (action.kind === "goto" && typeof action.target === "string") {
      return { kind: "goto", target: action.target };
    }
    if (action.kind === "set" && typeof action.name === "string") {
      return { kind: "set", name: action.name, value: action.value };
    }
    return { kind: "noop" };
  });
  return { conditions, actions };
}

function firstMatchingRule(rules: readonly RuntimeRule[], env: OperandEnv): RuntimeRule | null {
  for (const rule of rules) {
    if (allConditionsPass(rule.conditions, env)) return rule;
  }
  return null;
}

function allConditionsPass(conditions: readonly CompiledCondition[], env: OperandEnv): boolean {
  for (const condition of conditions) {
    if (!conditionPasses(condition, env)) return false;
  }
  return true; // empty `when` → matches (AND over zero conditions)
}

function conditionPasses(condition: CompiledCondition, env: OperandEnv): boolean {
  // Malformed compiled conditions (ref/op null) deterministically fail.
  if (condition === null || typeof condition !== "object") return false;
  if (condition.ref === null || condition.op === null || typeof condition.op !== "string") {
    return false;
  }
  const left = resolveOperand(condition.ref, env);
  const right =
    condition.rightRef !== null && typeof condition.rightRef === "object"
      ? resolveOperand(condition.rightRef, env)
      : condition.right;
  return checkCondition(condition.op, left, right);
}

function resolveTarget(
  next: string,
  node: RuntimeNode,
  scopes: Record<string, unknown>,
  endings: readonly string[] | null,
  currentId: string,
): string {
  if (isValidTarget(next, scopes, endings)) return next;
  if (isValidTarget(node.defaultNext, scopes, endings)) return node.defaultNext;
  return currentId;
}

function isValidTarget(
  target: string,
  scopes: Record<string, unknown>,
  endings: readonly string[] | null,
): boolean {
  if (target === "" || target === START_SCOPE) {
    return target === START_SCOPE && hasOwnKey(scopes, START_SCOPE);
  }
  if (hasOwnKey(scopes, target)) return true;
  if (target.startsWith("end:")) {
    // endings null/[] → unknown → accept any `end:*` (cannot verify);
    // otherwise the ending must be known (unknown goto → default next).
    return endings === null || endings.length === 0 || endings.includes(target.slice(4));
  }
  return false;
}

function getEndings(routing: Routing | RouteMap | null | undefined): readonly string[] | null {
  if (routing !== null && typeof routing === "object" && isRoutingShape(routing)) {
    return Array.isArray(routing.endings) ? routing.endings : null;
  }
  return null; // flat maps carry no endings → `end:*` targets are accepted
}

// ---------------------------------------------------------------------------
// Context / result helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Fresh null-prototype variable store seeded with own enumerable props. */
function newVarStore(seed: unknown): Record<string, unknown> {
  const vars: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (isPlainObject(seed)) {
    for (const [key, value] of Object.entries(seed)) vars[key] = value;
  }
  return vars;
}

function buildEnv(ctx: Partial<EvaluateCtx> | null | undefined): OperandEnv {
  return {
    answers: isPlainObject(ctx?.answers) ? ctx.answers : (Object.create(null) as Record<string, unknown>),
    variables: isPlainObject(ctx?.variables) ? ctx.variables : (Object.create(null) as Record<string, unknown>),
    hidden: isPlainObject(ctx?.hidden) ? ctx.hidden : (Object.create(null) as Record<string, unknown>),
    urlParams: isPlainObject(ctx?.urlParams) ? ctx.urlParams : null,
  };
}

function safeResult(ctx: Partial<EvaluateCtx> | null | undefined): EvaluateResult {
  const currentId =
    ctx !== null && typeof ctx === "object" && typeof ctx.currentBlockId === "string"
      ? ctx.currentBlockId
      : "";
  return { nextBlockId: currentId, variables: newVarStore(ctx?.variables) };
}
