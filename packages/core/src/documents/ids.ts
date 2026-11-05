/**
 * T10 — id generation for document_versions rows.
 *
 * INTEGRATION-DEBT: awaiting T02 `shared/ids.ts` (spec §4 pins UUIDv7 generated
 * in the app plus the base58 shortId helper). Swap this module for the shared
 * helper when it lands; uuidv7 semantics are identical so nothing else changes.
 *
 * RFC 9562 UUIDv7: 48-bit unix-ms timestamp + version/variant + random bits,
 * with a monotonic sequence counter in rand_a so IDs generated within the same
 * millisecond still sort in creation order (version rows are ordered by
 * (created_at, id) — see spec §6).
 */
import { randomBytes } from 'node:crypto';

let lastMs = 0;
let lastSeq = 0;

export function uuidv7(now: () => number = Date.now): string {
  const ms = Math.max(now(), lastMs);
  lastSeq = ms === lastMs ? (lastSeq + 1) & 0x0fff : 0;
  lastMs = ms;

  const rand = randomBytes(10); // 80 random bits (62 after rand_a/rand_b split)
  const timeHi = Math.floor(ms / 2 ** 24) & 0xffff;
  const timeMid = Math.floor(ms / 2 ** 16) & 0xffff;
  const timeLo = ms & 0xffff;

  const bytes = new Uint8Array(16);
  bytes[0] = (timeHi >> 8) & 0xff;
  bytes[1] = timeHi & 0xff;
  bytes[2] = (timeMid >> 8) & 0xff;
  bytes[3] = timeMid & 0xff;
  bytes[4] = (timeLo >> 8) & 0xff;
  bytes[5] = timeLo & 0xff;
  bytes[6] = 0x70 | (lastSeq >> 8); // version 7, rand_a high nibble carries seq
  bytes[7] = lastSeq & 0xff;
  bytes[8] = 0x80 | ((rand[0] ?? 0) & 0x3f); // variant 10 + rand_b high bits
  bytes.set(rand.subarray(1, 8), 9); // rand_b remaining 56 bits

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
