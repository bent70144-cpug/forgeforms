/**
 * T10 — canonical JSON hashing + immutability helpers.
 *
 * No external deps: sha256 via node:crypto (core is server-side only; the
 * renderer consumer reads the already-built snapshot).
 */
import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization (sorted object keys, stable array order).
 * Used for body-change detection and etag computation — must be a pure
 * function of data, not key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(serialize(value));

  function serialize(node: unknown): unknown {
    if (node === null || typeof node !== 'object') {
      return node === undefined ? null : node;
    }
    if (Array.isArray(node)) {
      return node.map(serialize);
    }
    if (node instanceof Date) {
      return node.toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      out[key] = serialize((node as Record<string, unknown>)[key]);
    }
    return out;
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Hash of the canonical form — equal data always yields the same digest. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Structurally cloned deep copy for JSON-ish data; Date instances are
 * preserved as Dates (repository records carry timestamps).
 */
export function structuralClone<T>(value: T): T {
  return cloneNode(value);
}

function cloneNode<T>(node: T): T {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (node instanceof Date) {
    return new Date(node.getTime()) as unknown as T;
  }
  if (Array.isArray(node)) {
    return node.map(cloneNode) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    out[key] = cloneNode(child);
  }
  return out as T;
}

/** Recursively freezes an object graph (plain objects + arrays). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
