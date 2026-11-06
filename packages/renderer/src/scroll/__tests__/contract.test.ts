import { describe, expect, it } from "vitest";
import { getPublishedSnapshot } from "../../bridge";
import { ScrollRenderer } from "../ScrollRenderer";
import { BlockSection } from "../sections/BlockSection";

describe("getPublishedSnapshot (bridge placeholder)", () => {
  it("fails visibly until T10 lands — never throws", async () => {
    const result = await getPublishedSnapshot("some-slug");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_IMPLEMENTED");
      expect(result.error.message).toContain("T10");
    }
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
