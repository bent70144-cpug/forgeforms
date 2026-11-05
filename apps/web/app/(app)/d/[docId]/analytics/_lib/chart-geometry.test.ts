// T19 — unit tests for the pure chart geometry (no DOM, no chart lib).
import { describe, expect, it } from "vitest";

import {
  buildAreaPath,
  buildLinePath,
  formatInt,
  formatPct,
  niceMax,
  scaleX,
  scaleY,
  shortDayLabel,
} from "./chart-geometry";

describe("niceMax", () => {
  it("picks a rounded axis max above the data", () => {
    expect(niceMax(1)).toBe(5);
    expect(niceMax(5)).toBe(5);
    expect(niceMax(6)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(260)).toBe(500);
    expect(niceMax(2600)).toBe(5000);
  });

  it("never returns 0 or negative", () => {
    expect(niceMax(0)).toBe(5);
    expect(niceMax(-3)).toBe(5);
  });
});

describe("scaleX / scaleY", () => {
  it("spreads points across the plot area inclusive of both edges", () => {
    expect(scaleX(0, 5, 100, 10, 10)).toBe(10);
    expect(scaleX(4, 5, 100, 10, 10)).toBe(90);
    expect(scaleX(2, 5, 100, 10, 10)).toBe(50);
  });

  it("centers a single point", () => {
    expect(scaleX(0, 1, 100, 10, 10)).toBe(50);
  });

  it("maps values onto the vertical axis with padding", () => {
    // height 200, padTop 10, padBottom 20 → usable 170, baseline y=180
    expect(scaleY(100, 100, 200, 10, 20)).toBe(10);
    expect(scaleY(0, 100, 200, 10, 20)).toBe(180);
    expect(scaleY(50, 100, 200, 10, 20)).toBe(95);
  });

  it("falls back to the baseline for a zero max (empty data)", () => {
    expect(scaleY(7, 0, 200, 10, 20)).toBe(180);
  });
});

describe("paths", () => {
  it("builds a polyline path", () => {
    expect(buildLinePath([])).toBe("");
    expect(buildLinePath([{ x: 10, y: 20.456 }])).toBe("M10 20.46");
    expect(buildLinePath([{ x: 0, y: 10 }, { x: 30, y: 5 }])).toBe("M0 10 L30 5");
  });

  it("closes area paths down to the baseline", () => {
    expect(buildAreaPath([{ x: 0, y: 10 }, { x: 30, y: 5 }], 40)).toBe("M0 10 L30 5 L30 40 L0 40 Z");
    expect(buildAreaPath([], 40)).toBe("");
  });

  it("handles single-point areas", () => {
    expect(buildAreaPath([{ x: 15, y: 10 }], 40)).toBe("M15 10 L15 40 Z");
  });
});

describe("formatting", () => {
  it("formats integers with thousands separators", () => {
    expect(formatInt(12483)).toBe("12,483");
    expect(formatInt(0)).toBe("0");
  });

  it("formats rates as percentages", () => {
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(1)).toBe("100%");
    expect(formatPct(0.75)).toBe("75%");
    expect(formatPct(1 / 3)).toBe("33.3%");
  });

  it("shortens day keys for axis labels", () => {
    expect(shortDayLabel("2026-11-06")).toBe("11-06");
  });
});
