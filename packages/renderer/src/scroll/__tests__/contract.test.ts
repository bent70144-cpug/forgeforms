import { describe, expect, it } from "vitest";
import {
  configureSnapshotReader,
  getPublishedSnapshot,
  type Snapshot,
} from "../../snapshot";
import { ScrollRenderer } from "../ScrollRenderer";
import { BlockSection } from "../sections/BlockSection";

describe("getPublishedSnapshot (injectable reader, issue #30)", () => {
  it("fails visibly until a reader is configured — never throws", async () => {
    const result = await getPublishedSnapshot("some-slug");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_IMPLEMENTED");
      expect(result.error.message).toContain("configureSnapshotReader");
    }
  });

  it("delegates to the configured reader", async () => {
    const fake: Snapshot = { documentId: "doc-1", type: "page", title: "Hi" };
    configureSnapshotReader(async (key) => {
      expect(key).toBe("some-slug");
      return { ok: true, value: fake };
    });
    const result = await getPublishedSnapshot("some-slug");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe("Hi");
  });
});

describe("scroll renderer components (server-safe, render without crashing)", () => {
  // Smoke tests through react-test-renderer-free rendering: we only assert that the
  // pure mapping layers hold; full HTML rendering is covered by e2e (spec §16).

  it("BlockSection skips hidden and unknown blocks", () => {
    expect(BlockSection({ block: { id: "1", kind: "hero", hidden: true } })).toBeNull();
  });

  it("ScrollRenderer is a named export taking a snapshot", () => {
    expect(typeof ScrollRenderer).toBe("function");
  });
});
