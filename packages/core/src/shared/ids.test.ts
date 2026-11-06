import { describe, expect, it } from "vitest";
import {
  SHORT_ID_PREFIXES,
  decodeBase58,
  encodeBase58,
  isShortId,
  isUuidV7,
  parseShortId,
  shortId,
  uuidv7,
} from "./ids.ts";

const BASE58_CHAR = /^[1-9A-HJ-NP-Za-km-z]$/;

describe("uuidv7", () => {
  it("produces valid UUIDv7 strings (format)", () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(isUuidV7(id)).toBe(true);
    }
  });

  it("is unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(uuidv7());
    expect(seen.size).toBe(1000);
  });

  it("is time-ordered: later unixMs sorts lexicographically later", () => {
    let prev = uuidv7(1_000);
    for (const ms of [2_000, 3_000, 10_000, 1_700_000_000_000, 4_102_444_800_000]) {
      const next = uuidv7(ms);
      expect(next > prev).toBe(true);
      prev = next;
    }
  });
});

describe("shortId", () => {
  it("has the `<prefix>_<22 base58 chars>` format (no 0/O/I/l)", () => {
    for (const prefix of SHORT_ID_PREFIXES) {
      const id = shortId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      const body = id.slice(prefix.length + 1);
      expect(body).toHaveLength(22);
      for (const char of body) expect(BASE58_CHAR.test(char)).toBe(true);
      expect(isShortId(id)).toBe(true);
    }
  });

  it("generates unique public ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(shortId("doc"));
    expect(seen.size).toBe(1000);
  });

  it("round-trips back to the exact uuid it was built from", () => {
    for (let i = 0; i < 200; i++) {
      const uuid = uuidv7();
      const parsed = parseShortId(shortId("doc", uuid));
      expect(parsed).toEqual({ prefix: "doc", uuid });
    }
  });

  it("round-trips the all-zero uuid (padding edge case)", () => {
    const uuid = "00000000-0000-0000-0000-000000000000";
    const encoded = encodeBase58(uuid);
    expect(encoded).toBe("1".repeat(22));
    expect(decodeBase58(encoded)).toBe(uuid);
    expect(parseShortId(shortId("ast", uuid))).toEqual({ prefix: "ast", uuid });
  });

  it("preserves time ordering after encoding (uuidv7 → shortId)", () => {
    let prev = shortId("doc", uuidv7(1_000));
    for (const ms of [2_000, 3_000, 10_000, 1_700_000_000_000]) {
      const next = shortId("doc", uuidv7(ms));
      expect(next > prev).toBe(true);
      prev = next;
    }
  });

  it("rejects malformed or unknown ids", () => {
    expect(parseShortId("doc")).toBeNull();
    expect(parseShortId("doc_")).toBeNull();
    expect(parseShortId("doc_short")).toBeNull();
    expect(parseShortId("user_" + "1".repeat(22))).toBeNull(); // unknown prefix
    expect(parseShortId("doc_0OIl" + "1".repeat(18))).toBeNull(); // excluded chars
    expect(parseShortId("doc_" + "1".repeat(21))).toBeNull(); // wrong length
    expect(isShortId("doc_short")).toBe(false);
  });

  it("generates from a fresh uuidv7 when none is passed", () => {
    const parsed = parseShortId(shortId("sub"));
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.prefix).toBe("sub");
    expect(isUuidV7(parsed.uuid)).toBe(true);
  });

  it("encodeBase58 is fixed-width and injective", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const encoded = encodeBase58(uuidv7());
      expect(encoded).toHaveLength(22);
      seen.add(encoded);
    }
    expect(seen.size).toBe(500);
  });
});
