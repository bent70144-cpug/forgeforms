<<<<<<< HEAD
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
import { parseShortId } from "./shared/ids.ts";

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


// ---- T14 additions (lead merge): snapshot model + submissions-local logic shim ----
import { z } from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts `doc_<short58>` (public form) or a raw uuid. */
export function parseDocumentId(id: string): string | null {
  if (UUID_RE.test(id)) return id.toLowerCase();
  const parsed = parseShortId(id);
  if (parsed?.prefix === "doc" && UUID_RE.test(parsed.uuid)) return parsed.uuid;
  return null;
}

/* ------------------------------------------------------------------ *
 * Document / snapshot model (spec §7/§8) — awaiting T10
 * ------------------------------------------------------------------ */

export type RuleWhen = {
  left: string; // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "isEmpty" | "matches";
  right?: unknown;
};

export type SnapshotEnding = { id: string; title: string; body?: string; redirectUrl?: string };

export type SnapshotSettings = {
  progressBar?: boolean;
  autoAdvance?: boolean;
  showBranding?: boolean;
  captcha?: boolean;
  closeAt?: string;
  maxSubmissions?: number;
};

/** Compiled routing map keyed by blockId (spec §8/§9). */
export type RouteNode = { defaultNext?: string; rules?: Rule[] };
export type Routing = Record<string, RouteNode>;

/**
 * Published snapshot (spec §8). INTEGRATION-DEBT: the spec's snapshot type has
 * no `workspaceId`, but ingest must scope submissions by workspace — T10 must
 * expose `documents.workspace_id` on the published snapshot.
 */
export type Snapshot = {
  documentId: string;
  workspaceId: string;
  versionId: string;
  type: "form" | "page" | "portfolio";
  title: string;
  blocks: Block[];
  endings: SnapshotEnding[];
  routing: Routing;
  settings: SnapshotSettings;
};

/* ------------------------------------------------------------------ *
 * Logic engine (spec §9) — awaiting T13
 * ------------------------------------------------------------------ */

export type EvaluateCtx = {
  answers: Record<string, unknown>;
  variables: Record<string, unknown>;
  hidden: Record<string, unknown>;
  currentBlockId: string;
};

export type EvaluateResult = { nextBlockId: string | `end:${string}`; variables: Record<string, unknown> };

export type LogicEvaluate = (routing: Routing, ctx: EvaluateCtx) => EvaluateResult;

const SENTINEL_END = "end:__default__";

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/** Select answers are normalized before comparison: {optionId}/{other} → string, {optionIds} → array (§9). */
function normalizeOperand(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if ("optionId" in obj) return obj.optionId;
    if ("other" in obj) return obj.other;
    if ("optionIds" in obj) return obj.optionIds;
  }
  return v;
}

function resolveOperand(ref: unknown, ctx: EvaluateCtx): unknown {
  if (typeof ref !== "string") return ref;
  if (ref.startsWith("@block:")) return normalizeOperand(ctx.answers[ref.slice("@block:".length)]);
  if (ref.startsWith("@var:")) return ctx.variables[ref.slice("@var:".length)];
  if (ref.startsWith("@hidden:")) return ctx.hidden[ref.slice("@hidden:".length)];
  return ref;
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) =>
    deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function evalWhen(c: RuleWhen, ctx: EvaluateCtx): boolean {
  const left = resolveOperand(c.left, ctx);
  const right = c.right;
  switch (c.op) {
    case "eq":
      return deepEq(left, right);
    case "neq":
      return !deepEq(left, right);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const l = asNumber(left);
      const r = asNumber(right);
      if (l == null || r == null) return false;
      if (c.op === "gt") return l > r;
      if (c.op === "gte") return l >= r;
      if (c.op === "lt") return l < r;
      return l <= r;
    }
    case "contains":
      if (typeof left === "string" && right != null) return left.includes(String(right));
      if (Array.isArray(left)) return left.some((v) => deepEq(v, right));
      if (left && typeof left === "object")
        return Object.values(left).some((v) => deepEq(v, right));
      return false;
    case "isEmpty":
      return isEmptyValue(left);
    case "matches":
      if (typeof left !== "string" || typeof right !== "string") return false;
      try {
        return new RegExp(right).test(left);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Runtime evaluation (spec §9): rules scoped to `currentBlockId` in array
 * order, first whose `when` all pass wins (fallback only if none matched);
 * unknown `goto` targets fall back to the default next; a missing routing
 * node degrades to a sentinel end (never crashes).
 */
export const evaluate: LogicEvaluate = (routing, ctx) => {
  const variables = { ...ctx.variables };
  const node = routing[ctx.currentBlockId];
  let next: string | undefined;
  if (node) {
    const rules = node.rules ?? [];
    const matched =
      rules.find((r) => !r.isFallback && r.when.every((c) => evalWhen(c, ctx))) ??
      rules.find((r) => r.isFallback === true);
    if (matched) {
      for (const action of matched.then) {
        if (action.type === "set") variables[action.var] = action.value;
        else if (action.type === "goto") {
          // Unknown goto target → fall back to default next (§9).
          if (action.target.startsWith("end:") || routing[action.target]) next = action.target;
        }
      }
    }
    next ??= node.defaultNext;
  }
  return { nextBlockId: next ?? SENTINEL_END, variables };
};

/**
 * Minimal `compile` (spec §9) used by tests and as a wiring fallback until
 * T13 lands. Computes default-next as "next question block in document
 * order, after the last `end:<first ending>`" and indexes rules by scope.
 * `isQuestion` is injected because block families live in the block registry.
 */
export function compileLite(
  rules: Rule[],
  blocks: Block[],
  endings: ReadonlyArray<{ id: string; title?: string }>,
  isQuestion: (block: Block) => boolean,
): Routing {
  const order: string[] = [];
  const visit = (list: Block[]): void => {
    for (const b of list) {
      if (isQuestion(b)) order.push(b.id);
      if (b.children?.length) visit(b.children);
    }
  };
  visit(blocks);

  const endTarget = `end:${endings[0]?.id ?? "default"}`;
  const routing: Routing = {};
  order.forEach((id, i) => {
    routing[id] = { defaultNext: order[i + 1] ?? endTarget, rules: [] };
  });

  const pushRule = (rule: Rule): void => {
    const node = routing[rule.scope];
    if (node) node.rules = [...(node.rules ?? []), rule];
  };
  for (const rule of rules) pushRule(rule);

  const startRules = rules.filter((r) => r.scope === "start");
  if (order.length > 0 || startRules.length > 0) {
    routing.start = { defaultNext: order[0] ?? endTarget, rules: startRules };
  }
  return routing;
}

/* ------------------------------------------------------------------ *
 * Misc shared helpers
 * ------------------------------------------------------------------ */

/** Zod schema for `documentId` as accepted by the ingest API (spec §10.3). */
export const DocumentIdSchema = z.string().min(1);

/** Parse an ISO datetime string; returns null when invalid. */
export function parseIsoDate(value: string): Date | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

=======
// INTEGRATION-DEBT: awaiting T02/T14/T17 — minimal stand-in types for the pieces this
// module needs from parallel tickets. The integrator MUST delete this file and re-point
// imports to the real surfaces once they land:
//   - Ctx / AppError kernel            → T02  (@formforge/core shared kernel)
//   - submissions repository           → T14  (@formforge/db repositories)
//   - Mailer (Resend)                  → T17  (@formforge/core/integrations)
//   - BullMQ enqueue                   → T17  (queue topology)
// Everything here is intentionally structural (no runtime code) so the swap is
// type-compatible at the wiring site.

/**
 * A submission row as streamed for export (spec §6 `submissions` + joined `answers`).
 * `answers` is keyed by block id (`answers.block_id`). Dates may arrive as `Date`
 * (pg driver) or ISO strings — consumers must coerce defensively.
 */
export type SubmissionRow = {
  id: string;
  workspaceId: string;
  documentId: string;
  /** Version of the document the submission answered. */
  versionId: string;
  /** "draft" | "completed" | "spam" (spec §6). Exports stream "completed" rows. */
  status: string;
  /** Answers keyed by question block id. */
  answers: Record<string, unknown>;
  /** Logic variables (score, price, …). */
  variables: Record<string, unknown>;
  /** Hidden fields / UTM capture. */
  hidden: Record<string, unknown>;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
};

export type SubmissionStreamParams = {
  workspaceId: string;
  documentId: string;
  /** Inclusive lower bound on `completedAt`. */
  from?: Date;
  /** Inclusive upper bound on `completedAt`. */
  to?: Date;
};

/**
 * Cursor-based submission reader (spec §4 pagination). Implementations (T14) are
 * expected to apply `from`/`to` and tenant scoping in SQL; the CSV export service
 * additionally filters defensively per row.
 */
export interface SubmissionReader {
  streamByCursor(params: SubmissionStreamParams): AsyncIterable<SubmissionRow>;
}

/** Minimal mailer surface (T17 lands the real one over Resend, spec §12 `email` queue). */
export interface Mailer {
  send(message: { to: string; subject: string; text: string; html?: string }): Promise<void>;
}

/** Minimal enqueue surface (T17 owns the BullMQ topology, spec §12). */
export type EnqueueFn = (
  queue: string,
  jobName: string,
  data: unknown,
  opts?: { jobId?: string; delayMs?: number },
) => Promise<unknown>;
>>>>>>> ticket/18-csv-export
