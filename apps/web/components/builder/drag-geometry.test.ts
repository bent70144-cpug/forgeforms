// Pure geometry helpers for the §6.2 pointer drag (useDragReorder.ts) —
// node env: the drop-slot math, activation constraint and auto-scroll ramp
// are specified here once; the jsdom flow tests (canvas-drag.test.tsx) prove
// the wiring on top of these contracts.
import { describe, expect, it } from "vitest";
import {
  ACTIVATION_DISTANCE_PX,
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_STEP_PX,
  activationReached,
  autoScrollDelta,
  computeDropSlot,
  dropSlotToDelta,
} from "./useDragReorder";

describe("activationReached (§6.2 ~8 px activation constraint)", () => {
  it("stays inactive below the threshold — clicks/taps must survive", () => {
    expect(activationReached(0, 0, 3, 3)).toBe(false); // ~4.2 px
    expect(activationReached(0, 0, 7, 0)).toBe(false); // 7 px < 8 px
    expect(ACTIVATION_DISTANCE_PX).toBe(8);
  });

  it("activates at and beyond the threshold (euclidean, not per-axis)", () => {
    expect(activationReached(0, 0, 8, 0)).toBe(true);
    expect(activationReached(0, 0, 6, 8)).toBe(true); // 10 px total, 8 on one axis
    expect(activationReached(0, 0, 0, -9)).toBe(true);
  });
});

describe("dropSlotToDelta (block.move index = position AFTER removal)", () => {
  it("maps slots before the source to negative deltas", () => {
    expect(dropSlotToDelta(0, 1)).toBe(-1);
    expect(dropSlotToDelta(0, 2)).toBe(-2);
    expect(dropSlotToDelta(2, 3)).toBe(-1);
  });

  it("maps the source's own gaps to delta 0 (no-op drop)", () => {
    expect(dropSlotToDelta(1, 1)).toBe(0); // gap above the source
    expect(dropSlotToDelta(2, 1)).toBe(0); // gap below the source
  });

  it("maps slots after the source shifted by one (removal semantics)", () => {
    expect(dropSlotToDelta(3, 1)).toBe(1);
    expect(dropSlotToDelta(2, 0)).toBe(1);
    expect(dropSlotToDelta(5, 2)).toBe(2);
  });
});

describe("computeDropSlot (first midpoint below the pointer)", () => {
  const rects = [
    { top: 0, bottom: 100 }, // mid 50
    { top: 100, bottom: 200 }, // mid 150
    { top: 200, bottom: 300 }, // mid 250
  ];

  it("returns the gap above a card when the pointer is in its upper half", () => {
    expect(computeDropSlot(30, rects)).toBe(0);
    expect(computeDropSlot(120, rects)).toBe(1);
  });

  it("returns the gap below a card when the pointer is in its lower half", () => {
    expect(computeDropSlot(60, rects)).toBe(1);
    expect(computeDropSlot(160, rects)).toBe(2);
  });

  it("returns list length past the last card's midpoint (end gap)", () => {
    expect(computeDropSlot(280, rects)).toBe(3);
    expect(computeDropSlot(10_000, rects)).toBe(3);
  });

  it("handles empty lists (stale drag) as slot 0", () => {
    expect(computeDropSlot(50, [])).toBe(0);
  });
});

describe("autoScrollDelta (edge ramp toward the nearest container edge)", () => {
  const top = 100;
  const bottom = 600;
  const zone = AUTO_SCROLL_EDGE_PX;
  const step = AUTO_SCROLL_STEP_PX;

  it("does nothing in the middle of the container", () => {
    expect(autoScrollDelta(300, top, bottom)).toBe(0);
  });

  it("scrolls up with a linear ramp inside the top edge zone", () => {
    expect(autoScrollDelta(top + zone, top, bottom)).toBe(0); // at the zone boundary
    expect(autoScrollDelta(top + zone / 2, top, bottom)).toBe(-step / 2);
    expect(autoScrollDelta(top, top, bottom)).toBe(-step);
    expect(autoScrollDelta(top - 40, top, bottom)).toBe(-step); // full speed past the edge
  });

  it("scrolls down with a linear ramp inside the bottom edge zone", () => {
    expect(autoScrollDelta(bottom - zone, top, bottom)).toBe(0);
    expect(autoScrollDelta(bottom - zone / 2, top, bottom)).toBe(step / 2);
    expect(autoScrollDelta(bottom + 10, top, bottom)).toBe(step);
  });

  it("rounds to integer px and degenerates safely", () => {
    expect(Number.isInteger(autoScrollDelta(top + 1, top, bottom))).toBe(true);
    expect(autoScrollDelta(0, 0, 0)).toBe(0); // no layout (jsdom)
  });
});
