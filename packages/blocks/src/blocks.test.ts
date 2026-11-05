import { describe, expect, it } from "vitest";
import { buttonBlock } from "./button";
import { heroBlock } from "./hero";
import { shortTextBlock } from "./short-text";
import { ButtonProps, ButtonStyle, buttonDefaultProps } from "./button/schema";
import { HeroProps, heroDefaultProps } from "./hero/schema";
import {
  ShortTextAnswer,
  ShortTextProps,
  shortTextDefaultProps,
  validateShortText,
} from "./short-text/schema";
import { defaultPropSets } from "./fixtures";

describe("hero props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    const props = HeroProps.parse(heroDefaultProps());
    expect(props).toEqual({ title: "Hero title", subtitle: "" });
  });

  it("fills the subtitle default", () => {
    const props = HeroProps.parse({ title: "Only title" });
    expect(props.subtitle).toBe("");
  });

  it("rejects an empty title", () => {
    expect(HeroProps.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects a cta without href", () => {
    expect(HeroProps.safeParse({ title: "T", cta: { label: "Go" } }).success).toBe(false);
  });

  it("rejects unknown prop keys (strict)", () => {
    expect(HeroProps.safeParse({ title: "T", bogus: 1 }).success).toBe(false);
  });

  it("matches the registered def", () => {
    expect(heroBlock.propsSchema).toBe(HeroProps);
    expect(heroBlock.defaultProps).toBe(defaultPropSets.hero);
  });
});

describe("short-text props + answer schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    expect(ShortTextProps.parse(shortTextDefaultProps())).toEqual({
      label: "Short answer",
      placeholder: "",
      required: false,
    });
  });

  it("supports the generic question props (spec §7.2 note)", () => {
    const props = ShortTextProps.parse({
      label: "Email",
      description: "We never share it",
      required: true,
      buttonText: "Next",
      imageAssetId: "ast_0001",
      prefillParam: "email",
    });
    expect(props.required).toBe(true);
    expect(props.prefillParam).toBe("email");
  });

  it("rejects a missing label", () => {
    expect(ShortTextProps.safeParse({}).success).toBe(false);
  });

  it("rejects a malformed prefillParam", () => {
    expect(ShortTextProps.safeParse({ label: "L", prefillParam: "1 bad" }).success).toBe(false);
  });

  it("answerSchema accepts strings only", () => {
    expect(ShortTextAnswer.safeParse("Ada").success).toBe(true);
    expect(ShortTextAnswer.safeParse("").success).toBe(true);
    expect(ShortTextAnswer.safeParse(42).success).toBe(false);
    expect(ShortTextAnswer.safeParse(undefined).success).toBe(false);
  });
});

describe("short-text validate (server-side + client-side)", () => {
  const base = shortTextDefaultProps();

  it("flags an empty answer when required", () => {
    expect(validateShortText("", { ...base, required: true })).toBe("This field is required");
    expect(validateShortText("   ", { ...base, required: true })).toBe("This field is required");
  });

  it("allows an empty answer when optional", () => {
    expect(validateShortText("", base)).toBeNull();
  });

  it("enforces maxLength", () => {
    expect(validateShortText("abcdef", { ...base, maxLength: 5 })).toBe(
      "Must be at most 5 characters",
    );
  });

  it("returns null for a valid answer", () => {
    expect(validateShortText("Ada", { ...base, required: true, maxLength: 10 })).toBeNull();
  });
});

describe("button props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    expect(ButtonProps.parse(buttonDefaultProps())).toEqual({
      label: "Button",
      href: "#",
      style: "primary",
    });
  });

  it("fills the style default", () => {
    const props = ButtonProps.parse({ label: "Go", href: "/x" });
    expect(props.style).toBe("primary");
  });

  it("rejects an unknown style", () => {
    expect(ButtonProps.safeParse({ label: "Go", href: "/x", style: "neon" }).success).toBe(false);
  });

  it("exposes exactly the three documented styles", () => {
    expect(ButtonStyle.options).toEqual(["primary", "secondary", "ghost"]);
  });

  it("rejects a missing href", () => {
    expect(ButtonProps.safeParse({ label: "Go" }).success).toBe(false);
  });

  it("matches the registered def", () => {
    expect(buttonBlock.propsSchema).toBe(ButtonProps);
    expect(buttonBlock.defaultProps).toBe(defaultPropSets.button);
  });
});
