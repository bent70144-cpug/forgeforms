import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BlockRegistrationError,
  blockKinds,
  getBlockDef,
  hasBlockDef,
  listBlockDefs,
  registeredKindSchemas,
  registerBlock,
} from "./registry";
import { buttonBlock } from "./button";
import { heroBlock } from "./hero";
import { shortTextBlock } from "./short-text";
import type { BlockDef } from "./registry";
import { HeroEditor } from "./hero/editor";
import { HeroRender } from "./hero/render";
import { HeroProps } from "./hero/schema";

// The three proven blocks are registered at import time (spec §7.1).
describe("import-time registry", () => {
  it("contains hero, short-text and button", () => {
    expect(hasBlockDef("hero")).toBe(true);
    expect(hasBlockDef("short-text")).toBe(true);
    expect(hasBlockDef("button")).toBe(true);
    expect(blockKinds()).toEqual(expect.arrayContaining(["hero", "short-text", "button"]));
  });

  it("exposes the correct families", () => {
    expect(getBlockDef("hero")?.family).toBe("content");
    expect(getBlockDef("short-text")?.family).toBe("question");
    expect(getBlockDef("button")?.family).toBe("action");
  });

  it("gives question blocks an answerSchema and content blocks none", () => {
    expect(getBlockDef("hero")?.answerSchema).toBeUndefined();
    expect(getBlockDef("button")?.answerSchema).toBeUndefined();
    expect(getBlockDef("short-text")?.answerSchema).toBeDefined();
  });

  it("returns undefined for unknown kinds without throwing", () => {
    expect(getBlockDef("marquee")).toBeUndefined();
    expect(hasBlockDef("marquee")).toBe(false);
  });

  it("provides kind → propsSchema for the strict document validator", () => {
    const schemas = registeredKindSchemas();
    expect(schemas["hero"]).toBe(heroBlock.propsSchema);
    expect(schemas["short-text"]).toBe(shortTextBlock.propsSchema);
    expect(schemas["button"]).toBe(buttonBlock.propsSchema);
  });

  it("listBlockDefs includes all registered defs", () => {
    const kinds = listBlockDefs().map((def) => def.kind);
    expect(kinds).toEqual(expect.arrayContaining(["hero", "short-text", "button"]));
  });
});

describe("registerBlock invariants (spec §7.1)", () => {
  const baseDef = (): BlockDef<HeroProps> => ({
    kind: "_test-def",
    family: "content",
    label: "Test",
    icon: "box",
    propsSchema: HeroProps,
    defaultProps: () => ({ title: "t", subtitle: "" }),
    Editor: HeroEditor,
    Render: HeroRender,
  });

  it("accepts a valid definition and exposes it", () => {
    registerBlock({ ...baseDef(), kind: "_test-accept" });
    expect(getBlockDef("_test-accept")?.label).toBe("Test");
  });

  it("rejects a duplicate kind", () => {
    expect(() => registerBlock({ ...baseDef(), kind: "hero" })).toThrow(BlockRegistrationError);
    // And the original definition survived.
    expect(getBlockDef("hero")?.label).toBe("Hero");
  });

  it("rejects a question block without answerSchema", () => {
    expect(() =>
      registerBlock({
        ...baseDef(),
        kind: "_test-question-no-answer",
        family: "question",
      }),
    ).toThrow(/must define answerSchema/);
  });

  it("rejects a non-question block with answerSchema (content never stores answers)", () => {
    expect(() =>
      registerBlock({
        ...baseDef(),
        kind: "_test-content-with-answer",
        answerSchema: z.string(),
      }),
    ).toThrow(/Only question blocks may define answerSchema/);
  });

  it("accepts a question block that defines answerSchema", () => {
    expect(() =>
      registerBlock({
        ...baseDef(),
        kind: "_test-question-ok",
        family: "question",
        propsSchema: z.strictObject({ label: z.string() }),
        defaultProps: () => ({ label: "Q" }),
        answerSchema: z.string(),
      }),
    ).not.toThrow();
    expect(getBlockDef("_test-question-ok")?.family).toBe("question");
  });

  it("rejects defaultProps() that violate propsSchema", () => {
    expect(() =>
      registerBlock({
        ...baseDef(),
        kind: "_test-bad-defaults",
        defaultProps: () => ({ title: "" }), // violates min(1) on title
      }),
    ).toThrow(/defaultProps.*do not satisfy propsSchema/);
  });

  it("rejects an unknown family", () => {
    expect(() =>
      registerBlock({ ...baseDef(), kind: "_test-bad-family", family: "widget" as never }),
    ).toThrow(/unknown family/);
  });

  it("rejects an empty kind", () => {
    expect(() => registerBlock({ ...baseDef(), kind: "" })).toThrow(/non-empty `kind`/);
  });
});
