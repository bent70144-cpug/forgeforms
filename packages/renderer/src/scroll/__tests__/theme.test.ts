import { describe, expect, it } from "vitest";
import {
  cssVarsToStyle,
  normalizeCssVars,
  normalizeFontFamilyValue,
  normalizeRadiusValue,
} from "../theme";

describe("normalizeCssVars", () => {
  it("falls back to the default theme when the snapshot has no vars", () => {
    const vars = normalizeCssVars(undefined);
    expect(vars["--ff-bg"]).toBe("#fbf9f4");
    expect(vars["--ff-fg"]).toBe("#1c1917");
    expect(vars["--ff-radius"]).toBe("0.5rem");
    expect(vars["--ff-font-heading"]).toBe('"Inter", sans-serif');
    expect(vars["--ff-font-body"]).toBe('"Inter", sans-serif');
  });

  it("passes through already-prefixed CSS variables", () => {
    const vars = normalizeCssVars({ "--ff-bg": "#ffffff", "--ff-radius": "12px" }, { withDefaults: false });
    expect(vars).toEqual({ "--ff-bg": "#ffffff", "--ff-radius": "12px" });
  });

  it("maps spec token names to canonical --ff-* variables", () => {
    const vars = normalizeCssVars(
      {
        "color.bg": "#ffffff",
        primary: "#ff0000",
        "color.primaryFg": "#ffffff",
        fontHeading: "Georgia",
        fontBody: '"Iowan Old Style", serif',
        radius: "lg",
      },
      { withDefaults: false },
    );
    expect(vars["--ff-bg"]).toBe("#ffffff");
    expect(vars["--ff-primary"]).toBe("#ff0000");
    expect(vars["--ff-primary-fg"]).toBe("#ffffff");
    expect(vars["--ff-font-heading"]).toBe('"Georgia", sans-serif');
    expect(vars["--ff-font-body"]).toBe('"Iowan Old Style", serif');
    expect(vars["--ff-radius"]).toBe("1rem");
  });

  it("accepts underscore/case variants of canonical token names", () => {
    const vars = normalizeCssVars(
      { "color.primary_fg": "#123456", PrimaryFG: "#654321" },
      { withDefaults: false },
    );
    expect(vars["--ff-primary-fg"]).toBe("#654321"); // later keys win
  });

  it("maps unknown custom tokens to --ff-<slug> variables", () => {
    const vars = normalizeCssVars({ "color.accent": "#f00", "FF Custom Token": "#0f0" }, { withDefaults: false });
    expect(vars["--ff-color-accent"]).toBe("#f00");
    expect(vars["--ff-custom-token"]).toBe("#0f0");
  });

  it("normalizes bare ff-* keys without double prefixing", () => {
    const vars = normalizeCssVars({ "ff-bg": "#abcdef" }, { withDefaults: false });
    expect(vars["--ff-bg"]).toBe("#abcdef");
    expect(vars["--ff-ff-bg"]).toBeUndefined();
  });

  it("lets input override defaults and skips empty values", () => {
    const vars = normalizeCssVars({ "--ff-bg": "", "color.bg": "  ", "--ff-primary": " #0a0a0a " });
    expect(vars["--ff-bg"]).toBe("#fbf9f4");
    expect(vars["--ff-primary"]).toBe("#0a0a0a");
  });

  it("ignores non-string values", () => {
    const vars = normalizeCssVars({ "--ff-bg": 42 as unknown as string }, { withDefaults: false });
    expect(vars["--ff-bg"]).toBeUndefined();
  });
});

describe("normalizeRadiusValue", () => {
  it.each([
    ["none", "0px"],
    ["sm", "0.25rem"],
    ["md", "0.5rem"],
    ["lg", "1rem"],
    ["full", "9999px"],
    ["12", "12px"],
    ["1.5", "1.5px"],
    ["12px", "12px"],
    ["0.75rem", "0.75rem"],
  ])("maps %s → %s", (input, expected) => {
    expect(normalizeRadiusValue(input)).toBe(expected);
  });
});

describe("normalizeFontFamilyValue", () => {
  it("wraps a bare family name in a quoted stack", () => {
    expect(normalizeFontFamilyValue("Inter")).toBe('"Inter", sans-serif');
  });

  it("passes through stacks that are already quoted or composed", () => {
    expect(normalizeFontFamilyValue('"Iowan Old Style", serif')).toBe('"Iowan Old Style", serif');
    expect(normalizeFontFamilyValue("ui-sans-serif, system-ui")).toBe("ui-sans-serif, system-ui");
  });

  it("falls back to Inter for empty input", () => {
    expect(normalizeFontFamilyValue("  ")).toBe('"Inter", sans-serif');
  });
});

describe("cssVarsToStyle", () => {
  it("keeps only custom properties", () => {
    const style = cssVarsToStyle({ "--ff-bg": "#fff", "not-a-var": "#000" });
    expect(style).toEqual({ "--ff-bg": "#fff" });
  });

  it("produces an object assignable to CSSProperties", () => {
    const style = cssVarsToStyle(normalizeCssVars({ "color.bg": "#fff" }));
    expect(style["--ff-bg"]).toBe("#fff");
  });
});
