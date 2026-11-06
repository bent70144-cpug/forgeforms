// Shared kernel: IDs (spec §4).
//
// - Internal primary keys are UUIDv7, generated in the app (`uuidv7()`).
//   UUIDv7 embeds a millisecond timestamp in its top bits, so hex ordering
//   is time ordering — good for index locality.
// - Public IDs in URLs use a prefix + base58 short form (`doc_…`, `sub_…`,
//   `ast_…`). The base58 payload is the full UUID re-encoded, so it is
//   bijective (round-trips back to the UUID) and fixed-width (22 chars),
//   which also preserves time ordering lexicographically. Sequential ids are
//   never exposed raw.

import { UUID, uuidv7 as generateUuidV7 } from "uuidv7";

/**
 * Generate a UUIDv7 (optionally at a specific unix time in ms — tests/clocks).
 * With an explicit `unixMs` the timestamp is fixed and the randomness comes
 * from crypto-grade `Math.random` bits; without it we delegate to the
 * battle-tested `uuidv7` package (monotonic within the same millisecond).
 */
export function uuidv7(unixMs?: number): string {
  if (unixMs === undefined) return generateUuidV7();
  return UUID.fromFieldsV7(
    unixMs,
    Math.floor(Math.random() * 0x1000), // rand_a: 12 bits
    Math.floor(Math.random() * 0x40000000), // rand_b hi: 30 bits
    Math.floor(Math.random() * 0x100000000), // rand_b lo: 32 bits
  ).toString();
}

export const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Base58 (Bitcoin alphabet): excludes 0, O, I, l to survive human copying.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_CHAR = /^[1-9A-HJ-NP-Za-km-z]$/;
/** Fixed width of the base58 encoding of a 128-bit value: 58^22 > 2^128. */
const BASE58_UUID_LENGTH = 22;

// "evt" added by T14 (event ids); extend as tickets need more prefixes.
export const SHORT_ID_PREFIXES = ["doc", "sub", "ast", "evt"] as const;
export type ShortIdPrefix = (typeof SHORT_ID_PREFIXES)[number];
export type PrefixedShortId = `${ShortIdPrefix}_${string}`;

/** A prefixed public id: `<prefix>_<22 base58 chars>`, e.g. `doc_2r…`. */
export const SHORT_ID_REGEX = new RegExp(
  `^[a-z]+_[${BASE58_ALPHABET}]{${BASE58_UUID_LENGTH}}$`,
);

export function isShortIdPrefix(value: string): value is ShortIdPrefix {
  return (SHORT_ID_PREFIXES as readonly string[]).includes(value);
}

function uuidToBigInt(uuid: string): bigint {
  const hex = uuid.replaceAll("-", "");
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(`not a uuid: ${uuid}`);
  }
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 4n) | BigInt(parseInt(hex[i]!, 16));
  }
  return value;
}

function bigIntToUuid(value: bigint): string {
  const hex = value.toString(16).padStart(32, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Encode a UUID into fixed-width base58 (22 chars). Leading `1` chars are
 * zero-padding; decoding is exact. Fixed width keeps lexicographic order
 * equal to numeric order, so encoded ids stay time-ordered for UUIDv7.
 */
export function encodeBase58(uuid: string): string {
  let value = uuidToBigInt(uuid);
  if (value >= 1n << 128n) throw new Error(`not a 128-bit value: ${uuid}`);
  let out = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    out = BASE58_ALPHABET.charAt(digit) + out;
    value /= 58n;
  }
  return out.padStart(BASE58_UUID_LENGTH, "1");
}

/** Decode a fixed-width base58 string back into a canonical uuid. */
export function decodeBase58(encoded: string): string | null {
  if (encoded.length !== BASE58_UUID_LENGTH) return null;
  let value = 0n;
  for (const char of encoded) {
    if (!BASE58_CHAR.test(char)) return null;
    value = value * 58n + BigInt(BASE58_ALPHABET.indexOf(char));
  }
  if (value >= 1n << 128n) return null; // out of uuid range
  return bigIntToUuid(value);
}

/**
 * Public id for URLs: `shortId("doc")` → `doc_<22 chars>`.
 * Time-ordered, url-safe, and never leaks the raw uuid.
 */
export function shortId(prefix: ShortIdPrefix, uuid: string = uuidv7()): PrefixedShortId {
  return `${prefix}_${encodeBase58(uuid)}`;
}

/** Inverse of `shortId`. Returns null for anything malformed or unknown. */
export function parseShortId(
  id: string,
): { prefix: ShortIdPrefix; uuid: string } | null {
  const separator = id.indexOf("_");
  if (separator <= 0) return null;
  const prefix = id.slice(0, separator);
  if (!isShortIdPrefix(prefix)) return null;
  const uuid = decodeBase58(id.slice(separator + 1));
  if (uuid === null) return null;
  return { prefix, uuid };
}

/** Format-only check for a prefixed public id (`doc_…`, `sub_…`, `ast_…`). */
export function isShortId(value: string): value is PrefixedShortId {
  return SHORT_ID_REGEX.test(value) && isShortIdPrefix(value.slice(0, value.indexOf("_")));
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_REGEX.test(value);
}

// ISSUE #30: moved from the retired core `bridge.ts`.
const ANY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts a raw uuid or the `doc_<short58>` public id; returns the canonical
 * uuid form, or null. Used by ingest and asset URL resolution (spec §10.3).
 */
export function parseDocumentId(id: string): string | null {
  if (ANY_UUID_RE.test(id)) return id.toLowerCase();
  const parsed = parseShortId(id);
  if (parsed?.prefix === "doc" && ANY_UUID_RE.test(parsed.uuid)) return parsed.uuid;
  return null;
}
