// T07 — server-side ops applier tests (spec §8; client parity with
// apps/web/lib/builder/ops.ts — same vocabulary, same merge semantics).
import { describe, expect, it } from "vitest";
import { applyDocOps, applyBodyOps, DocOpError } from "../apply";
import type { DocumentBodyJson } from "../model";

function emptyBody(type: DocumentBodyJson["type"] = "form"): DocumentBodyJson {
  return {
    schemaVersion: 1,
    type,
    theme: { tokens: { "color.bg": "#ffffff" }, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
    settings: { seo: {}, locale: "en", progressBar: true, autoAdvance: true, showBranding: true, captcha: false, notifyEmails: [] },
    blocks: [],
    endings: [],
    logic: { rules: [] },
  };
}

function doc(body: DocumentBodyJson = emptyBody(), meta = { title: "My form", slug: "my-form" }) {
  return { meta, body };
}

describe("applyBodyOps — blocks", () => {
  it("block.insert at the root and inside a parent", () => {
    const hero = { id: "h1", kind: "hero", props: { title: "Hello" } };
    const section = { id: "s1", kind: "section", props: {}, children: [] };
    const afterSection = applyBodyOps(emptyBody(), [
      { op: "block.insert", index: 0, block: section },
    ]);
    expect(afterSection.blocks).toHaveLength(1);
    const afterNested = applyBodyOps(afterSection, [
      { op: "block.insert", parentId: "s1", index: 0, block: hero },
    ]);
    expect(afterNested.blocks[0]?.children).toEqual([hero]);
  });

  it("block.update shallow-merges props and null deletes a key", () => {
    const body = applyBodyOps(emptyBody(), [
      { op: "block.insert", index: 0, block: { id: "h1", kind: "hero", props: { title: "Hello", subtitle: "Sub" } } },
      { op: "block.update", id: "h1", props: { title: "Changed" } },
    ]);
    expect((body.blocks[0] as { props: Record<string, unknown> }).props).toEqual({ title: "Changed", subtitle: "Sub" });
    const without = applyBodyOps(body, [{ op: "block.update", id: "h1", props: { subtitle: null } }]);
    expect((without.blocks[0] as { props: Record<string, unknown> }).props).toEqual({ title: "Changed" });
  });

  it("block.move handles same-list final-index semantics", () => {
    const seeded = applyBodyOps(emptyBody(), [
      { op: "block.insert", index: 0, block: { id: "a", kind: "text", props: {} } },
      { op: "block.insert", index: 1, block: { id: "b", kind: "text", props: {} } },
      { op: "block.insert", index: 2, block: { id: "c", kind: "text", props: {} } },
    ]);
    // move a to the end (final index after removal = 2)
    const moved = applyBodyOps(seeded, [{ op: "block.move", id: "a", index: 2 }]);
    expect(moved.blocks.map((b) => b.id)).toEqual(["b", "c", "a"]);
    // no-op move keeps position
    const same = applyBodyOps(moved, [{ op: "block.move", id: "c", index: 1 }]);
    expect(same.blocks.map((b) => b.id)).toEqual(["b", "c", "a"]);
  });

  it("block.move across parents and rejects own-subtree targets", () => {
    const section = { id: "s1", kind: "section", props: {}, children: [] };
    const seeded = applyBodyOps(emptyBody(), [
      { op: "block.insert", index: 0, block: section },
      { op: "block.insert", index: 1, block: { id: "a", kind: "text", props: {} } },
    ]);
    const moved = applyBodyOps(seeded, [{ op: "block.move", id: "a", parentId: "s1", index: 0 }]);
    expect(moved.blocks[0]?.children?.[0]?.id).toBe("a");
    expect(moved.blocks).toHaveLength(1);

    // s1 into its own child → invalid, never corrupts the tree
    expect(() =>
      applyBodyOps(moved, [{ op: "block.move", id: "s1", parentId: "a", index: 0 }]),
    ).toThrowError(DocOpError);
  });

  it("block.remove deletes nested blocks", () => {
    const seeded = applyBodyOps(emptyBody(), [
      { op: "block.insert", index: 0, block: { id: "s1", kind: "section", props: {}, children: [{ id: "a", kind: "text", props: {} }] } },
    ]);
    const removed = applyBodyOps(seeded, [{ op: "block.remove", id: "a" }]);
    expect((removed.blocks[0] as { children?: unknown[] }).children).toEqual([]);
    expect(() => applyBodyOps(removed, [{ op: "block.remove", id: "a" }])).toThrowError(DocOpError);
  });

  it("errors carry the op index and field path for §4 details", () => {
    try {
      applyBodyOps(emptyBody(), [{ op: "block.remove", id: "ghost" }]);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DocOpError);
      const e = err as DocOpError;
      expect(e.opIndex).toBe(0);
      expect(e.path).toBe("ops[0].id");
      expect(e.appCode).toBe("VALIDATION");
    }
  });
});

describe("applyBodyOps — settings/theme/endings/rules", () => {
  it("settings.update shallow-merges and null-resets fields", () => {
    const updated = applyBodyOps(emptyBody(), [
      { op: "settings.update", patch: { progressBar: false, seo: { title: "SEO" } } },
    ]);
    expect(updated.settings!.progressBar).toBe(false);
    expect(updated.settings!.seo).toEqual({ title: "SEO" });
    const reset = applyBodyOps(updated, [
      { op: "settings.update", patch: { closeAt: null, seo: { title: null } } },
    ]);
    expect("closeAt" in reset.settings!).toBe(false);
    expect(reset.settings!.seo).toEqual({});
    expect(updated.settings!.progressBar).toBe(false);
  });

  it("theme.update merges tokens and null removes a token", () => {
    const updated = applyBodyOps(emptyBody(), [
      { op: "theme.update", patch: { tokens: { "color.bg": "#000", "color.primary": "#123456" } } },
    ]);
    expect(updated.theme.tokens["color.primary"]).toBe("#123456");
    const removed = applyBodyOps(updated, [{ op: "theme.update", patch: { tokens: { "color.bg": null } } }]);
    expect("color.bg" in removed.theme.tokens).toBe(false);
  });

  it("ending.upsert inserts then replaces by id; ending.remove deletes", () => {
    const withEnding = applyBodyOps(emptyBody(), [
      { op: "ending.upsert", ending: { id: "e1", title: "Thanks!" } },
      { op: "ending.upsert", ending: { id: "e1", title: "Thanks a lot!" } },
    ]);
    expect(withEnding.endings).toEqual([{ id: "e1", title: "Thanks a lot!" }]);
    expect(applyBodyOps(withEnding, [{ op: "ending.remove", id: "e1" }]).endings).toEqual([]);
  });

  it("rule.upsert inserts then replaces by id; rule.remove deletes", () => {
    const rule = { id: "r1", scope: "b1", when: [], then: [], isFallback: false };
    const withRule = applyBodyOps(emptyBody(), [
      { op: "rule.upsert", rule },
      { op: "rule.upsert", rule: { ...rule, scope: "start" } },
    ]);
    expect(withRule.logic!.rules).toHaveLength(1);
    expect((withRule.logic!.rules[0] as { scope?: string } | undefined)?.scope).toBe("start");
    expect(applyBodyOps(withRule, [{ op: "rule.remove", id: "r1" }]).logic!.rules).toEqual([]);
  });
});

describe("applyDocOps — meta", () => {
  it("meta.update changes title/slug but never the body", () => {
    const next = applyDocOps(doc(), [{ op: "meta.update", patch: { title: "New", slug: "new-slug" } }]);
    expect(next.meta).toEqual({ title: "New", slug: "new-slug" });
    expect(next.body.type).toBe("form");
  });

  it("applies a mixed batch left-to-right", () => {
    const next = applyDocOps(doc(), [
      { op: "block.insert", index: 0, block: { id: "h1", kind: "hero", props: { title: "Hero" } } },
      { op: "meta.update", patch: { title: "Landing" } },
      { op: "block.update", id: "h1", props: { title: "Hero!" } },
    ]);
    expect(next.meta.title).toBe("Landing");
    expect((next.body.blocks[0] as { props: Record<string, unknown> }).props["title"]).toBe("Hero!");
  });

  it("never mutates the input document (functional update)", () => {
    const original = doc(emptyBody());
    applyDocOps(original, [
      { op: "block.insert", index: 0, block: { id: "h1", kind: "hero", props: {} } },
      { op: "theme.update", patch: { tokens: { "color.bg": "#000" } } },
    ]);
    expect(original.body.blocks).toHaveLength(0);
    expect(original.body.theme.tokens["color.bg"]).toBe("#ffffff");
  });
});
