import { describe, expect, it } from "vitest";
import { csvSafeCell, displayCell, truncateLabel } from "./labels";

describe("truncateLabel", () => {
  it("passes short labels through (trimmed)", () => {
    expect(truncateLabel("  Email  ", 48)).toBe("Email");
  });

  it("truncates with an ellipsis within the budget", () => {
    const out = truncateLabel("How likely are you to recommend FormForge?", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("How likely are you")).toBe(true);
  });

  it("respects max=1 and degenerate budgets", () => {
    expect(truncateLabel("abc", 1)).toBe("…");
    expect(truncateLabel("abc", 0)).toBe("…");
  });

  it("keeps an exact-length label intact", () => {
    expect(truncateLabel("abcdefghij", 10)).toBe("abcdefghij");
  });
});

describe("csvSafeCell", () => {
  it("collapses newlines and control characters to one line", () => {
    expect(csvSafeCell("line one\nline two\r\nline\tthree")).toBe("line one line two line three");
  });

  it("doubles double-quotes so any CSV writer stays correct", () => {
    expect(csvSafeCell('He said "hello"')).toBe('He said ""hello""');
  });

  it("neutralizes formula-injection prefixes", () => {
    expect(csvSafeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvSafeCell("+1 cmd")).toBe("'+1 cmd");
    expect(csvSafeCell("-rm -rf")).toBe("'-rm -rf");
    expect(csvSafeCell("@import url")).toBe("'@import url");
  });

  it("does not guard ordinary text", () => {
    expect(csvSafeCell("plain value")).toBe("plain value");
  });

  it("truncates to the max budget", () => {
    const out = csvSafeCell("x".repeat(400), 100);
    expect(out.length).toBe(100);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("displayCell", () => {
  it("marks stripped newlines with a visual hint", () => {
    expect(displayCell("first\nsecond")).toBe("first ⏎ second");
  });

  it("collapses runs of whitespace", () => {
    expect(displayCell("a   b\t c")).toBe("a b c");
  });

  it("truncates long answers", () => {
    expect(displayCell("y".repeat(90), 20).length).toBe(20);
  });
});
