// T16 — ObjectStore port tests (spec §10.1 presign, §17 signed downloads only).
// The port started life as T18's CSV seam (put/get); assets extends it with
// head/readRange/remove/presignPut/presignGet. Both implementations must obey
// the same contract so tests can run DB-free against the in-memory store.

import { describe, expect, it } from "vitest";
import { InMemoryObjectStore } from "./object-store.ts";

describe("InMemoryObjectStore (assets surface)", () => {
  it("put/get round-trips text objects (T18 compat)", async () => {
    const store = new InMemoryObjectStore();
    const put = await store.put({ key: "exports/w/d/e.csv", body: "a,b\n1,2\n", contentType: "text/csv" });
    expect(put).toEqual({ key: "exports/w/d/e.csv", sizeBytes: 8 });
    const got = await store.get("exports/w/d/e.csv");
    expect(got?.body).toBe("a,b\n1,2\n");
    expect(got?.sizeBytes).toBe(8);
    expect(got?.contentType).toBe("text/csv");
  });

  it("stores and ranges binary objects byte-exact", async () => {
    const store = new InMemoryObjectStore();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
    await store.put({ key: "uploads/x", body: bytes, contentType: "image/png" });
    const first8 = await store.readRange("uploads/x", 8);
    expect([...(first8 ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await store.readRange("uploads/x", 64)).toEqual(bytes);
    expect(await store.readRange("missing", 8)).toBeNull();
  });

  it("head reports existence + metadata without the body", async () => {
    const store = new InMemoryObjectStore();
    await store.put({ key: "k", body: "12345", contentType: "text/plain" });
    expect(await store.head("k")).toEqual({ key: "k", sizeBytes: 5, contentType: "text/plain" });
    expect(await store.head("nope")).toBeNull();
  });

  it("remove deletes the object", async () => {
    const store = new InMemoryObjectStore();
    await store.put({ key: "k", body: "x" });
    await store.remove("k");
    expect(await store.head("k")).toBeNull();
    await expect(store.remove("k")).resolves.toBeUndefined(); // idempotent
  });

  it("presignPut issues a key-carrying URL and presignGet only for existing keys", async () => {
    const store = new InMemoryObjectStore();
    const put = await store.presignPut("uploads/a/b.png", { contentType: "image/png", expiresInSeconds: 600 });
    expect(put.key).toBe("uploads/a/b.png");
    expect(put.url).toContain("uploads/a/b.png");
    expect(put.url).toContain("X-Amz-Expires=600");

    // GET presign is denied for absent keys (signed downloads of real objects).
    expect(await store.presignGet("absent", { expiresInSeconds: 60 })).toBeNull();
    await store.put({ key: "uploads/a/b.png", body: new Uint8Array([1]) });
    expect(await store.presignGet("uploads/a/b.png", { expiresInSeconds: 60 })).not.toBeNull();
  });

  it("presigned PUT url expires: validatePresignedPut rejects stale signatures", async () => {
    const store = new InMemoryObjectStore({ now: () => new Date("2026-01-01T00:00:00Z") });
    const put = await store.presignPut("k", { expiresInSeconds: 60 });
    expect(store.validatePresignedPut(put.url, new Date("2026-01-01T00:00:30Z"))).toEqual({ ok: true, key: "k" });
    expect(store.validatePresignedPut(put.url, new Date("2026-01-01T00:02:00Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(store.validatePresignedPut("garbage", new Date("2026-01-01T00:00:30Z"))).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
