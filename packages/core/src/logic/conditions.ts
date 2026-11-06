// Condition operators (spec §7 `Rule.when` ops, semantics per spec §9).
// Pure, deterministic, isomorphic. Every function is total: it returns a
// boolean for any input and never throws.

/** Depth cap for structural equality (defends against pathological/cyclic input). */
const MAX_EQUALITY_DEPTH = 16;

// ---------------------------------------------------------------------------
// Answer normalization (spec §9: "select → optionId, rating → number")
// ---------------------------------------------------------------------------

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Normalizes a raw answer value before comparison:
 * - `{ optionId }` (single-select / dropdown) → the optionId string
 * - `{ other }` (single-select "allowOther") → the other string
 * - `{ optionIds }` (multi-select) → the optionId array
 * - `{ assetIds }` (file-upload) → the assetId array
 * - primitives and arrays pass through unchanged (rating/nps are already numbers)
 */
export function normalizeAnswer(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  if (hasOwn(obj, "optionId") && typeof obj.optionId === "string") return obj.optionId;
  if (hasOwn(obj, "other") && typeof obj.other === "string") return obj.other;
  if (hasOwn(obj, "optionIds") && Array.isArray(obj.optionIds)) return obj.optionIds;
  if (hasOwn(obj, "assetIds") && Array.isArray(obj.assetIds)) return obj.assetIds;
  return value;
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

/**
 * Coerces to a finite number for ordering comparisons (`gt/gte/lt/lte`).
 * Numbers (finite) and fully-parseable non-empty numeric strings coerce;
 * booleans, arrays, objects, `NaN`, `""` and missing values do not.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True for `undefined`, `null`, `""`, `[]` and objects without own keys. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

/**
 * Deterministic loose equality used by `eq`/`neq`/`contains`:
 * - same-type primitives compare strictly (with NaN ≍ NaN)
 * - number ↔ numeric-string compares numerically
 * - booleans never equal non-booleans
 * - arrays: same length + element-wise equality (order-sensitive)
 * - objects: same own-key sets + value-wise equality (order-insensitive)
 * - `null` and `undefined` are not equal to each other (use `isEmpty` for missing)
 */
export function looseEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true; // NaN !== NaN falls through to the number pair below
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return false;
  if (typeof a === "number" && typeof b === "string") return numericStringEquals(a, b);
  if (typeof a === "string" && typeof b === "number") return numericStringEquals(b, a);
  if (depth >= MAX_EQUALITY_DEPTH) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((el, i) => looseEqual(el, b[i], depth + 1));
  }
  if (a instanceof Array || b instanceof Array) return false;
  if (typeof a === "object" && typeof b === "object") {
    return looseEqualObjects(a as Record<string, unknown>, b as Record<string, unknown>, depth);
  }
  return false;
}

function numericStringEquals(num: number, str: string): boolean {
  const parsed = toFiniteNumber(str);
  return parsed !== null && parsed === num;
}

function looseEqualObjects(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  depth: number,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!hasOwn(b, key)) return false;
    if (!looseEqual(a[key], b[key], depth + 1)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Regex cache (bounded; deterministic — keyed by pattern string)
// ---------------------------------------------------------------------------

const regexCache = new Map<string, RegExp | null>();
const REGEX_CACHE_MAX = 512;

function compileRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern);
  } catch {
    compiled = null; // invalid pattern → condition is false, never throws
  }
  if (regexCache.size >= REGEX_CACHE_MAX) regexCache.clear();
  regexCache.set(pattern, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Operator dispatch
// ---------------------------------------------------------------------------

/**
 * Evaluates one condition against already-resolved operand values.
 * `op` is guaranteed non-null by the compiler; unknown ops (only possible via
 * hand-built programs) evaluate to `false`.
 */
export function checkCondition(op: string, left: unknown, right: unknown): boolean {
  switch (op) {
    case "eq":
      return looseEqual(left, right);
    case "neq":
      return !looseEqual(left, right);
    case "gt":
      return compareOrder(left, right) > 0;
    case "gte":
      return compareOrder(left, right) >= 0;
    case "lt":
      return compareOrder(left, right) < 0;
    case "lte":
      return compareOrder(left, right) <= 0;
    case "contains":
      return containsValue(left, right);
    case "isEmpty":
      return isEmptyValue(left);
    case "matches":
      return matchesPattern(left, right);
    default:
      return false;
  }
}

/**
 * -1 / 0 / +1 when both sides coerce to numbers, `NaN` when incomparable
 * (all four ordering comparisons are false against `NaN`, which is exactly
 * the desired "incomparable" behavior).
 */
function compareOrder(a: unknown, b: unknown): number {
  const na = toFiniteNumber(a);
  const nb = toFiniteNumber(b);
  if (na === null || nb === null) return Number.NaN;
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

function containsValue(left: unknown, right: unknown): boolean {
  if (right === undefined) return false;
  if (Array.isArray(left)) return left.some((el) => looseEqual(el, right));
  if (typeof left === "string") return left.includes(String(right));
  return false;
}

function matchesPattern(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return false;
  if (typeof right !== "string") return false;
  const re = compileRegex(right);
  if (re === null) return false;
  try {
    return re.test(String(left));
  } catch {
    return false;
  }
}
