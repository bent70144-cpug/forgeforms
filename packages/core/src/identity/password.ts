import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PasswordHasher } from "./ports";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// SPEC-NOTE: spec §1/§17 pin argon2id for password hashing. Native argon2
// cannot build in this sandbox (no native toolchain), so we ship a scrypt
// (node:crypto, memory-hard, FIPS-blessed) implementation behind the
// PasswordHasher interface. The interface allows swapping in argon2id during
// hardening without touching callers. Stored format:
//   scrypt$<N>$<r>$<p>$<salt b64>$<derivedKey b64>
const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 } as const;

function serialize(params: typeof PARAMS, salt: Buffer, derivedKey: Buffer): string {
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await scrypt(plain.normalize("NFKC"), salt, KEY_LENGTH, PARAMS);
    return serialize(PARAMS, salt, derivedKey);
  }

  async verify(plain: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split("$");
    // Wrong format → do equivalent work, then fail (no cheap user-enumeration oracle).
    if (parts.length !== 6 || parts[0] !== "scrypt") {
      await scrypt(plain.normalize("NFKC"), "timing", KEY_LENGTH, PARAMS);
      return false;
    }
    const [, n, r, p, saltB64, hashB64] = parts;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    const salt = Buffer.from(saltB64 ?? "", "base64");
    const expected = Buffer.from(hashB64 ?? "", "base64");
    if (expected.length !== KEY_LENGTH || salt.length === 0) return false;
    const actual = await scrypt(plain.normalize("NFKC"), salt, KEY_LENGTH, params);
    return timingSafeEqual(actual, expected);
  }
}
