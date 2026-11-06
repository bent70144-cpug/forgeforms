// ID helpers for the templates module.
//
// Block ids are nanoid(10)-style per spec §7 (`id: z.string().min(1) // stable, nanoid(10)`).
// SPEC-NOTE: the shared `shortId` helper lands with T02 in packages/core/src/shared/ids.ts;
// until then templates generate ids locally with the same shape (no new dependency).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function randomInts(count: number): number[] {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const out = new Uint32Array(count);
    cryptoObj.getRandomValues(out);
    return Array.from(out);
  }
  // Deterministic-enough fallback for exotic runtimes without WebCrypto.
  return Array.from({ length: count }, () => Math.floor(Math.random() * 0xffffffff));
}

/** nanoid(10)-compatible id using the default nanoid alphabet. */
export function createBlockId(): string {
  const ints = randomInts(10);
  let id = "";
  for (const n of ints) id += ALPHABET[n % ALPHABET.length];
  return id;
}
