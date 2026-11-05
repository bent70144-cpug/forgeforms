// packages/core/src/bridge.ts
// INTEGRATION-DEBT: awaiting T02/T10/T13.
//
// T14 (public ingest API, issue #14) needs the shared kernel (Ctx, Result,
// AppError — spec §3/§4), the published-snapshot contract (spec §8) and the
// logic engine (`evaluate` — spec §9). Those are owned by T02, T10 and T13
// which run in parallel; this file provides *minimal, spec-faithful* stand-ins
// so the ingest service can compile and be tested today.
//
// When T02/T10/T13 land, the integrator should:
//   1. delete this file,
//   2. repoint `@formforge/core/bridge` imports to the root `@formforge/core`
//      exports (or re-export the real implementations from here),
//   3. replace the wiring defaults in apps/web (evaluate, snapshot reader).
//
// Everything in here is intentionally dependency-free (only `zod`, already a
// core dependency, is used) and pure — no I/O.

import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Shared kernel (spec §3/§4) — awaiting T02
 * ------------------------------------------------------------------ */

export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "INTERNAL";

export type ErrorDetail = { path: string; message: string };

/** One error type across the API (spec §4). API layers map code → HTTP status. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: ErrorDetail[];

  constructor(code: AppErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

/** Services return `Result<T, AppError>`; no thrown errors across module boundaries (spec §3). */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type Ctx = {
  workspaceId: string;
  actor: { type: "user" | "token" | "mcp" | "system"; id: string };
  requestId: string;
  now: () => Date;
};

/* ------------------------------------------------------------------ *
 * IDs (spec §4) — awaiting T02 shared/ids.ts
 * ------------------------------------------------------------------ */

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** UUIDv7 (time-ordered), generated in the app (spec §4). */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ts = Date.now(); // 48-bit big-endian timestamp
  bytes[0] = Number((ts / 2 ** 40) & 0xff);
  bytes[1] = Number((ts / 2 ** 32) & 0xff);
  bytes[2] = Number((ts / 2 ** 24) & 0xff);
  bytes[3] = Number((ts / 2 ** 16) & 0xff);
  bytes[4] = Number((ts / 2 ** 8) & 0xff);
  bytes[5] = Number(ts & 0xff);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("invalid uuid");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToB58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = `1${out}`;
    else break;
  }
  return out || "1";
}

function b58ToBytes(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base58");
    n = n * 58n + BigInt(idx);
    if (n > 0xffffffffffffffffffffffffffffffffn) throw new Error("base58 overflow");
  }
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) throw new Error("base58 overflow");
  return bytes;
}

/** Public short id: prefix + base58 of the uuid bytes (spec §4). */
export function shortId(prefix: string, uuid: string): string {
  return `${prefix}_${bytesToB58(uuidToBytes(uuid))}`;
}

/** Reverse of {@link shortId}; returns null when the string is not a valid short id. */
export function parseShortId(id: string): { prefix: string; uuid: string } | null {
  const sep = id.indexOf("_");
  if (sep <= 0) return null;
  const prefix = id.slice(0, sep);
  try {
    return { prefix, uuid: Array.from(b58ToBytes(id.slice(sep + 1)), (b) => b.toString(16).padStart(2, "0")).join("").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5") };
  } catch {
    return null;
  }
}

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

export type Block = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: Block[];
  hidden?: boolean;
};

export type RuleWhen = {
  left: string; // "@block:<id>" | "@var:<name>" | "@hidden:<name>"
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "isEmpty" | "matches";
  right?: unknown;
};

export type RuleAction = { type: "goto"; target: string } | { type: "set"; var: string; value: unknown };

export type Rule = {
  id: string;
  scope: string; // blockId this rule runs after, or "start"
  when: RuleWhen[];
  then: RuleAction[];
  isFallback?: boolean;
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
