// T07 — ops vocabulary tests (spec §8 "Autosave (authoring)").
// The discriminated union is the single source of truth for what
// PATCH /api/v1/documents/:id accepts; T20 (logic builder) consumes the types.
import { describe, expect, it } from "vitest";
import { DocumentOpSchema, PatchDocumentOpsSchema } from "./ops";

const block = { id: "b1", kind: "short-text", props: { label: "Name" } };

describe("DocumentOpSchema", () => {
  it.each([
    [
      "block.insert",
      { op: "block.insert", parentId: null, index: 0, block },
    ],
    ["block.update", { op: "block.update", id: "b1", props: { label: "Full name" } }],
    ["block.move", { op: "block.move", id: "b1", parentId: "sec1", index: 2 }],
    ["block.remove", { op: "block.remove", id: "b1" }],
    ["settings.update", { op: "settings.update", patch: { progressBar: false } }],
    ["theme.update", { op: "theme.update", patch: { tokens: { "color.bg": "#fff" } } }],
    [
      "ending.upsert",
      { op: "ending.upsert", ending: { id: "end1", title: "Thanks!" } },
    ],
    ["ending.remove", { op: "ending.remove", id: "end1" }],
    [
      "rule.upsert",
      {
        op: "rule.upsert",
        rule: { id: "r1", scope: "b1", when: [], then: [], isFallback: false },
      },
    ],
    ["rule.remove", { op: "rule.remove", id: "r1" }],
    ["meta.update", { op: "meta.update", patch: { title: "New title", slug: "new-title" } }],
  ])("accepts a valid %s op", (_kind, op) => {
    const parsed = DocumentOpSchema.safeParse(op);
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown op kind with the offending path", () => {
    const parsed = DocumentOpSchema.safeParse({ op: "block.explode", id: "b1" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toContain("op");
    }
  });

  it("rejects block.insert with a negative index and non-object props", () => {
    expect(DocumentOpSchema.safeParse({ op: "block.insert", index: -1, block }).success).toBe(false);
    expect(
      DocumentOpSchema.safeParse({ op: "block.update", id: "b1", props: "nope" }).success,
    ).toBe(false);
  });

  it("rejects meta.update with an empty title", () => {
    const parsed = DocumentOpSchema.safeParse({ op: "meta.update", patch: { title: "  " } });
    expect(parsed.success).toBe(false);
  });

  it("accepts null as a delete-token in settings/theme patches", () => {
    expect(
      DocumentOpSchema.safeParse({ op: "settings.update", patch: { closeAt: null } }).success,
    ).toBe(true);
    expect(
      DocumentOpSchema.safeParse({
        op: "theme.update",
        patch: { tokens: { "color.bg": null } },
      }).success,
    ).toBe(true);
  });

  it("rejects settings.update patches with unknown value types", () => {
    expect(
      DocumentOpSchema.safeParse({ op: "settings.update", patch: { progressBar: "yes" } }).success,
    ).toBe(false);
  });
});

describe("PatchDocumentOpsSchema", () => {
  it("accepts { baseRev, ops } and rejects stale/absent baseRev", () => {
    expect(
      PatchDocumentOpsSchema.safeParse({ baseRev: 3, ops: [{ op: "block.remove", id: "b1" }] })
        .success,
    ).toBe(true);
    expect(PatchDocumentOpsSchema.safeParse({ baseRev: -1, ops: [] }).success).toBe(false);
    expect(PatchDocumentOpsSchema.safeParse({ ops: [] }).success).toBe(false);
  });

  it("reports field-level paths for an invalid op inside the array (spec §4 details)", () => {
    const parsed = PatchDocumentOpsSchema.safeParse({
      baseRev: 1,
      ops: [{ op: "block.insert", index: 0, block: { id: "", kind: "hero", props: {} } }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("ops.0.block.id"))).toBe(true);
    }
  });
});
