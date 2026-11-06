import { describe, expect, it } from "vitest";
import { Block, BlockBase, cloneBlockWithNewId } from "./block";
import { formatZodPath } from "./errors";

describe("Block schema (spec §7)", () => {
  it("parses a minimal block", () => {
    const block = Block.parse({ id: "blk_1234567", kind: "hero", props: {} });
    expect(block).toEqual({ id: "blk_1234567", kind: "hero", props: {} });
  });

  it("parses nested children recursively", () => {
    const block = Block.parse({
      id: "blk_parent01",
      kind: "section",
      props: { background: "muted" },
      children: [
        {
          id: "blk_child001",
          kind: "button",
          props: { label: "Hi", href: "/" },
          children: [{ id: "blk_grandch", kind: "hero", props: { title: "x" } }],
        },
      ],
    });
    expect(block.children?.[0]?.children?.[0]?.kind).toBe("hero");
  });

  it("rejects a missing id with a field-level path", () => {
    const result = BlockBase.safeParse({ kind: "hero", props: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(issue?.path).toEqual(["id"]);
    expect(formatZodPath(issue?.path ?? [])).toBe("id");
  });

  it("rejects an empty id", () => {
    expect(Block.safeParse({ id: "", kind: "hero", props: {} }).success).toBe(false);
  });

  it("rejects non-record props", () => {
    expect(Block.safeParse({ id: "a", kind: "hero", props: 42 }).success).toBe(false);
  });

  it("rejects a non-boolean hidden flag", () => {
    expect(
      Block.safeParse({ id: "a", kind: "hero", props: {}, hidden: "yes" }).success,
    ).toBe(false);
  });
});

describe("cloneBlockWithNewId", () => {
  it("rewrites ids deeply", () => {
    const source = Block.parse({
      id: "blk_parent01",
      kind: "section",
      props: {},
      children: [
        { id: "blk_child001", kind: "hero", props: {} },
        { id: "blk_child002", kind: "hero", props: {} },
      ],
    });
    const clone = cloneBlockWithNewId(source, "blk_new0001");
    expect(clone.id).toBe("blk_new0001");
    expect(clone.children?.[0]?.id).toBe("blk_new0001-0");
    expect(clone.children?.[1]?.id).toBe("blk_new0001-1");
    expect(clone.children?.[0]?.id).not.toBe(source.children?.[0]?.id);
  });
});
