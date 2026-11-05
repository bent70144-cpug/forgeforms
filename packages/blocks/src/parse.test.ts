import { describe, expect, it } from "vitest";
// Import from the package root: the registry is built at import time (§7.1),
// so the kind modules must be loaded for strict validation to know the kinds.
import { parseDocument } from "./index";
import { validDocumentBodyFixture } from "./fixtures";

describe("parseDocument (registry-aware strict validation)", () => {
  it("parses a valid document with hero + short-text + button", () => {
    const result = parseDocument(validDocumentBodyFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.blocks.map((b) => b.kind)).toEqual(["hero", "short-text", "button"]);
    expect(result.data.settings.locale).toBe("en");
  });

  it("rejects an unknown kind with path blocks[1].kind", () => {
    const body = validDocumentBodyFixture();
    (body.blocks as Array<Record<string, unknown>>)[1] = {
      id: "blk_marq0001",
      kind: "marquee",
      props: {},
    };
    const result = parseDocument(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: "blocks[1].kind",
      message: 'Unknown block kind "marquee"',
    });
  });

  it("rejects an invalid prop type with path blocks[0].props.title", () => {
    const body = validDocumentBodyFixture();
    (body.blocks as Array<Record<string, unknown>>)[0] = {
      id: "blk_hero001",
      kind: "hero",
      props: { title: 42 },
    };
    const result = parseDocument(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({
      path: "blocks[0].props.title",
      message: expect.any(String),
    });
  });

  it("rejects unknown prop keys with path blocks[2].props.bogus (strict props)", () => {
    const body = validDocumentBodyFixture();
    (body.blocks as Array<Record<string, unknown>>)[2] = {
      id: "blk_button01",
      kind: "button",
      props: { label: "Go", href: "/x", style: "primary", bogus: 1 },
    };
    const result = parseDocument(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: "blocks[2].props.bogus",
      message: expect.stringContaining("bogus"),
    });
  });

  it("rejects a question block missing its label with path blocks[1].props.label", () => {
    const body = validDocumentBodyFixture();
    (body.blocks as Array<Record<string, unknown>>)[1] = {
      id: "blk_text0001",
      kind: "short-text",
      props: { placeholder: "hi" },
    };
    const result = parseDocument(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: "blocks[1].props.label",
      message: expect.any(String),
    });
  });

  it("rejects duplicate block ids with path blocks[2].id (schema layer)", () => {
    const body = validDocumentBodyFixture();
    const blocks = body.blocks as Array<Record<string, unknown>>;
    body.blocks = [blocks[0]!, blocks[1]!, { ...blocks[2]!, id: "blk_hero001" }];
    const result = parseDocument(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: "blocks[2].id",
      message: expect.stringContaining("Duplicate block id"),
    });
  });

  it("validates props nested in children with anchored paths", () => {
    const body = validDocumentBodyFixture();
    (body.blocks as Array<Record<string, unknown>>)[0] = {
      id: "blk_hero001",
      kind: "hero",
      props: { title: "Hi" },
      children: [
        { id: "blk_child001", kind: "button", props: { href: "/x" } }, // missing label
      ],
    };
    const result = parseDocument(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: "blocks[0].children[0].props.label",
      message: expect.any(String),
    });
  });

  it("round-trips a valid document through JSON", () => {
    const result = parseDocument(validDocumentBodyFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const round = parseDocument(JSON.parse(JSON.stringify(result.data)));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.data).toEqual(result.data);
  });
});
