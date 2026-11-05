// Tiny nanoid-compatible id generator (spec §7: stable, nanoid(10) ids).
// Zero-dep: crypto.getRandomValues over the nanoid default alphabet.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

export function newId(size = 10): string {
  const bytes = new Uint8Array(size);
  fillRandom(bytes);
  let id = "";
  for (let i = 0; i < size; i++) {
    const b = bytes[i];
    id += b === undefined ? ALPHABET[0] : ALPHABET[b % ALPHABET.length];
  }
  return id;
}

function fillRandom(bytes: Uint8Array): void {
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
    return;
  }
  // Test/dev fallback.
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
}
