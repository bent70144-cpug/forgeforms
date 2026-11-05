// Operand parsing + resolution (spec §9: "@block:<id> → answer value,
// @var:<name>, @hidden:<name>"). Pure, total, deterministic.

import { normalizeAnswer } from "./conditions.js";
import type { Operand } from "./types.js";

const PREFIXES = ["block", "var", "hidden"] as const;

/** Parses `"@block:<id>" | "@var:<name>" | "@hidden:<name>"`; null when malformed. */
export function parseOperand(raw: unknown): Operand | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("@")) return null;
  const colon = raw.indexOf(":");
  if (colon < 1) return null; // no colon, or "@" alone
  const source = raw.slice(1, colon);
  const name = raw.slice(colon + 1);
  if (name === "") return null;
  switch (source) {
    case "block":
    case "var":
    case "hidden":
      return { source, name };
    default:
      return null;
  }
}

/** True when a literal string should be re-interpreted as an operand reference. */
export function looksLikeOperand(raw: unknown): raw is string {
  return typeof raw === "string" && raw.startsWith("@") && PREFIXES.some((p) => raw.startsWith(`@${p}:`));
}

/** Safe own-property read — prototype keys (`__proto__`, `constructor`) never resolve. */
export function pick(obj: unknown, key: string): unknown {
  if (!hasOwnKey(obj, key)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

/** Own-property existence check (prototype chain excluded). */
export function hasOwnKey(obj: unknown, key: string): boolean {
  if (obj === null || typeof obj !== "object") return false;
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export interface OperandEnv {
  readonly answers: Record<string, unknown>;
  readonly variables: Record<string, unknown>;
  readonly hidden: Record<string, unknown>;
  /** URL params — fallback source for `@hidden` (SPEC-NOTE: see evaluate.ts). */
  readonly urlParams: Record<string, unknown> | null;
}

/**
 * Resolves a parsed operand to its value.
 * - `@block` → normalized answer value (missing block answers resolve to `undefined`)
 * - `@var` → variable value
 * - `@hidden` → hidden field, falling back to `urlParams` when absent
 */
export function resolveOperand(operand: Operand, env: OperandEnv): unknown {
  switch (operand.source) {
    case "block":
      return normalizeAnswer(pick(env.answers, operand.name));
    case "var":
      return pick(env.variables, operand.name);
    case "hidden": {
      if (hasOwnKey(env.hidden, operand.name)) return pick(env.hidden, operand.name);
      if (env.urlParams !== null && hasOwnKey(env.urlParams, operand.name)) {
        return pick(env.urlParams, operand.name);
      }
      return undefined;
    }
  }
}
