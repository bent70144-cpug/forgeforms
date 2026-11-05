import { describe, expect, it } from "vitest";
import type { Block } from "../results-bridge";
import {
  formatAnswer,
  formatDateTime,
  formatDateTimeShort,
  formatPercent,
  isEmptyAnswer,
  questionLabel,
  ratingScaleOf,
} from "./format";

const SELECT: Block = {
  id: "b_sel",
  kind: "single-select",
  props: {
    label: "Source",
    options: [
      { id: "a", label: "Search" },
      { id: "b", label: "Referral" },
    ],
  },
};

describe("isEmptyAnswer", () => {
  it("treats nullish/blank/empty-shell answers as empty", () => {
    expect(isEmptyAnswer(undefined)).toBe(true);
    expect(isEmptyAnswer(null)).toBe(true);
    expect(isEmptyAnswer("")).toBe(true);
    expect(isEmptyAnswer("   ")).toBe(true);
    expect(isEmptyAnswer([])).toBe(true);
    expect(isEmptyAnswer({})).toBe(true);
    expect(isEmptyAnswer({ optionIds: [] })).toBe(true);
    expect(isEmptyAnswer({ assetIds: [] })).toBe(true);
    expect(isEmptyAnswer({ other: "" })).toBe(true);
  });

  it("keeps real values", () => {
    expect(isEmptyAnswer("hi")).toBe(false);
    expect(isEmptyAnswer(0)).toBe(false);
    expect(isEmptyAnswer({ optionId: "a" })).toBe(false);
    expect(isEmptyAnswer({ optionIds: ["a"] })).toBe(false);
  });
});

describe("formatAnswer", () => {
  it("renders — for empty answers (spec §14.1.5)", () => {
    expect(formatAnswer(SELECT, undefined)).toBe("—");
    expect(formatAnswer(SELECT, {})).toBe("—");
  });

  it("maps option ids to labels from the snapshot", () => {
    expect(formatAnswer(SELECT, { optionId: "a" })).toBe("Search");
    expect(formatAnswer(SELECT, { optionId: "missing" })).toBe("missing");
  });

  it("formats Other answers", () => {
    expect(formatAnswer(SELECT, { other: "Reddit" })).toBe("Other: Reddit");
    expect(formatAnswer(SELECT, { other: "  " })).toBe("Other");
  });

  it("formats multi-select and file-upload shapes", () => {
    const multi: Block = {
      id: "b_m",
      kind: "multi-select",
      props: { label: "F", options: [{ id: "a", label: "Forms" }, { id: "b", label: "Logic" }] },
    };
    expect(formatAnswer(multi, { optionIds: ["a", "b"] })).toBe("Forms, Logic");
    expect(formatAnswer(multi, { optionIds: [] })).toBe("—");
    const file: Block = { id: "b_f", kind: "file-upload", props: { label: "Upload" } };
    expect(formatAnswer(file, { assetIds: ["a1", "a2", "a3"] })).toBe("3 files");
    expect(formatAnswer(file, { assetIds: ["a1"] })).toBe("1 file");
  });

  it("formats scalars", () => {
    expect(formatAnswer(SELECT, "plain text")).toBe("plain text");
    expect(formatAnswer(SELECT, 7)).toBe("7");
    expect(formatAnswer(SELECT, 4.25)).toBe(4.25.toString());
  });
});

describe("questionLabel / ratingScaleOf", () => {
  it("prefers props.label, falls back to kind + id", () => {
    expect(questionLabel(SELECT)).toBe("Source");
    expect(questionLabel({ id: "b1", kind: "email", props: {} })).toBe("Untitled email (b1)");
  });

  it("clamps the rating scale into 3–10 (spec §7.2)", () => {
    expect(ratingScaleOf({ id: "b", kind: "rating", props: { scale: 2 } })).toBe(3);
    expect(ratingScaleOf({ id: "b", kind: "rating", props: { scale: 10 } })).toBe(10);
    expect(ratingScaleOf({ id: "b", kind: "rating", props: { scale: 99 } })).toBe(10);
    expect(ratingScaleOf({ id: "b", kind: "rating", props: {} })).toBe(5);
  });
});

describe("date formatting", () => {
  it("formats UTC deterministically (no hydration drift)", () => {
    expect(formatDateTime("2026-11-06T14:05:00.000Z")).toBe("6 Nov 2026, 14:05 UTC");
    expect(formatDateTimeShort("2026-11-06T14:05:00.000Z")).toBe("6 Nov, 14:05");
  });

  it("degrades gracefully on invalid input", () => {
    expect(formatDateTime("nope")).toBe("—");
    expect(formatDateTimeShort("nope")).toBe("—");
  });
});

describe("formatPercent", () => {
  it("rounds to an integer percent", () => {
    expect(formatPercent(33.4)).toBe("33%");
    expect(formatPercent(99.6)).toBe("100%");
  });
});
