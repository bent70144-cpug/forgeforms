// Contrast-math tests (theme panel §8.2): hex parsing, luminance, the
// canonical ratios (black/white = 21, #777 on white ≈ 4.48) and label shape.

import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  hexToRgb,
  isHexColor,
  normalizeHex,
  passesAA,
  relativeLuminance,
  wcagLabel,
} from "./contrast";

describe("hexToRgb", () => {
  it("parses 6-digit hex with #", () => {
    expect(hexToRgb("#111827")).toEqual({ r: 17, g: 24, b: 39 });
    expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("parses 3-digit hex and expands each digit", () => {
    expect(hexToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#abc")).toEqual(hexToRgb("#aabbcc"));
  });

  it("accepts a missing # and surrounding whitespace", () => {
    expect(hexToRgb("111827")).toEqual({ r: 17, g: 24, b: 39 });
    expect(hexToRgb("  #fff ")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("rejects malformed values", () => {
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("#12")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb("#1234567")).toBeNull();
    expect(hexToRgb("#zzz")).toBeNull();
    expect(hexToRgb("blue")).toBeNull();
  });
});

describe("normalizeHex / isHexColor", () => {
  it("canonicalizes to lowercase #rrggbb", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#111827")).toBe("#111827");
    expect(normalizeHex("nope")).toBeNull();
  });

  it("requires the # in panel-style validation", () => {
    expect(isHexColor("#1a1a1a")).toBe(true);
    expect(isHexColor("#Fa0")).toBe(true);
    expect(isHexColor("1a1a1a")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });
});

describe("relativeLuminance", () => {
  it("maps black to 0 and white to 1", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it("is channel-weighted (green dominates)", () => {
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(green).toBeGreaterThan(blue);
  });
});

describe("contrastRatio", () => {
  it("black on white is exactly 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#fff", "#000")).toBe(21);
  });

  it("a color against itself is 1", () => {
    expect(contrastRatio("#123456", "#123456")).toBe(1);
  });

  it("matches the known #777-on-white value (≈ 4.48)", () => {
    expect(contrastRatio("#777777", "#ffffff")).toBe(4.48);
  });

  it("rounds to 2 decimals and is order-independent", () => {
    expect(contrastRatio("#111827", "#ffffff")).toBe(contrastRatio("#ffffff", "#111827"));
    expect(contrastRatio("#111827", "#ffffff")).toBe(17.74);
  });

  it("throws on invalid hex (callers validate first)", () => {
    expect(() => contrastRatio("#zzz", "#ffffff")).toThrow(TypeError);
  });
});

describe("passesAA / wcagLabel", () => {
  it("AA threshold is exactly 4.5", () => {
    expect(passesAA(4.5)).toBe(true);
    expect(passesAA(4.49)).toBe(false);
    expect(passesAA(21)).toBe(true);
  });

  it("labels a passing pair with a check", () => {
    expect(wcagLabel(4.7)).toBe("4.7:1 AA ✓");
  });

  it("labels a failing pair with the non-blocking warning", () => {
    expect(wcagLabel(3.2)).toBe("3.2:1 — below 4.5");
  });
});
