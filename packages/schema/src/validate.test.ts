import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateDocumentBody } from "./validate";

// Fixture kind schemas (strict) standing in for the registry — packages/blocks
// wires the real ones in `parseDocument`.
const kindSchemas = {
  hero: z.strictObject({
    title: z.string().min(1),
    subtitle: z.string().default(""),
    cta: z
      .strictObject({ label: z.string(), href: z.string() })
      .optional(),
  }),
  "short-text": z.strictObject({
    label: z.string().min(1),
    required: z.boolean().default(false),
  }),
};

// Deliberately loose block shape so fixtures can express invalid documents.
type LooseBlock = {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  children?: LooseBlock[];
};

const baseBody = () => ({
  schemaVersion: 1,
  type: "page",
  theme: { tokens: {} },
  settings: {},
  blocks: [
    { id: "blk_hero001", kind: "hero", props: { title: "Hello" } },
    { id: "blk_text0001", kind: "short-text", props: { label: "Name" } },
  ] as LooseBlock[],
});

describe("validateDocumentBody", () => {
  it("returns the parsed document for a valid body", () => {
    const result = validateDocumentBody(baseBody(), kindSchemas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.type).toBe("page");
    expect(result.data.settings.locale).toBe("en");
  });

  it("leaves stored props untouched (defaults are applied at render/builder time)", () => {
    const result = validateDocumentBody(baseBody(), kindSchemas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.blocks[0]?.props).toEqual({ title: "Hello" });
  });

  it("rejects an unknown kind with path blocks[1].kind", () => {
    const body = baseBody();
    body.blocks[1] = { id: "blk_marq0001", kind: "marquee", props: {} };
    const result = validateDocumentBody(body, kindSchemas);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: "blocks[1].kind",
      message: 'Unknown block kind "marquee"',
    });
  });

  it("rejects an invalid prop type with path blocks[0].props.title", () => {
    const body = baseBody();
    body.blocks[0] = { id: "blk_hero001", kind: "hero", props: { title: 42 } };
    const result = validateDocumentBody(body, kindSchemas);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({
      path: "blocks[0].props.title",
      message: expect.any(String),
    });
  });

  it("rejects unknown prop keys with path blocks[0].props.bogus (strict props)", () => {
    const body = baseBody();
    body.blocks[0] = {
      id: "blk_hero001",
      kind: "hero",
      props: { title: "Hi", bogus: true },
    };
    const result = validateDocumentBody(body, kindSchemas);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe("blocks[0].props.bogus");
  });

  it("validates props nested in children with anchored paths", () => {
    const body = baseBody();
    body.blocks[0] = {
      id: "blk_hero001",
      kind: "hero",
      props: { title: "Hi" },
      children: [
        {
          id: "blk_child001",
          kind: "short-text",
          props: { label: "" }, // violates min(1)
        },
      ],
    };
    const result = validateDocumentBody(body, kindSchemas);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe("blocks[0].children[0].props.label");
  });

  it("reports shape-level errors (missing id) before kind checks", () => {
    const body = baseBody();
    const blocks = body.blocks;
    body.blocks = [blocks[0]!, { kind: "marquee", props: {} }] as unknown as LooseBlock[];
    const result = validateDocumentBody(body, kindSchemas);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: "blocks[1].id", message: expect.any(String) },
    ]);
  });

  it("does not inject prop defaults into the stored body (render time applies them)", () => {
    const hero = z.strictObject({
      title: z.string(),
      extra: z.string().default("x"),
    });
    const body = baseBody();
    body.blocks[0] = { id: "blk_hero001", kind: "hero", props: { title: "Hi" } };
    const result = validateDocumentBody(body, {
      hero,
      "short-text": kindSchemas["short-text"]!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.blocks[0]?.props).toEqual({ title: "Hi" });
  });
});
