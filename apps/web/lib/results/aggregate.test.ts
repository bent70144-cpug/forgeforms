import { describe, expect, it } from "vitest";
import type { Block } from "../results-bridge";
import type { SubmissionDTO } from "./types";
import {
  aggregateBlock,
  aggregateSubmissions,
  buildSummary,
  classifyNps,
  summaryCountsOf,
  tallyNps,
} from "./aggregate";

const FIXED_NOW = "2026-11-06T12:00:00.000Z";

function submission(partial: Partial<SubmissionDTO>): SubmissionDTO {
  return {
    id: partial.id ?? "sub_x",
    documentId: "doc_1",
    versionId: "ver_1",
    status: partial.status ?? "completed",
    publicToken: "sub_tok",
    answers: partial.answers ?? {},
    variables: partial.variables ?? {},
    hidden: partial.hidden ?? {},
    meta: partial.meta ?? {},
    startedAt: partial.startedAt ?? "2026-11-05T10:00:00.000Z",
    completedAt:
      partial.completedAt !== undefined
        ? partial.completedAt
        : partial.startedAt ?? "2026-11-05T10:03:00.000Z",
  };
}

const TEST_BLOCKS: Block[] = [
  { id: "b_hero", kind: "hero", props: { title: "Survey" } },
  {
    id: "b_source",
    kind: "single-select",
    props: {
      label: "Source",
      options: [
        { id: "a", label: "Search" },
        { id: "b", label: "Referral" },
      ],
      allowOther: true,
    },
  },
  {
    id: "b_features",
    kind: "multi-select",
    props: {
      label: "Features",
      options: [
        { id: "a", label: "Forms" },
        { id: "b", label: "Pages" },
        { id: "c", label: "Logic" },
      ],
    },
  },
  { id: "b_rating", kind: "rating", props: { label: "Setup ease", scale: 5 } },
  { id: "b_nps", kind: "nps", props: { label: "Recommend?" } },
  { id: "b_number", kind: "number", props: { label: "Seats", min: 0, max: 100 } },
  { id: "b_text", kind: "long-text", props: { label: "Feedback" } },
];

/** Hand-computed fixture — every expected number below is derived by hand. */
const FIXTURE_SUBMISSIONS: SubmissionDTO[] = [
  submission({
    id: "s1",
    answers: {
      b_source: { optionId: "a" },
      b_features: { optionIds: ["a", "c"] },
      b_rating: 5,
      b_nps: 9,
      b_number: 4,
      b_text: "hello",
    },
  }),
  submission({
    id: "s2",
    answers: {
      b_source: { other: "Reddit" },
      b_features: { optionIds: ["b"] },
      b_rating: 3,
      b_nps: 7,
      b_number: 6,
      b_text: "world",
    },
  }),
  submission({
    id: "s3",
    answers: {
      b_source: { optionId: "b" },
      b_features: { optionIds: ["a", "b"] },
      b_rating: 4,
      b_nps: 2,
      b_number: 5,
      b_text: "",
    },
  }),
  submission({
    id: "s4",
    status: "draft",
    answers: { b_source: {} },
  }),
  submission({
    id: "s5",
    status: "spam",
    answers: { b_nps: 10, b_text: "asdf" },
  }),
];

describe("classifyNps (spec §14.1.5 segments)", () => {
  it("classifies 9–10 promoters, 7–8 passives, 0–6 detractors", () => {
    expect(classifyNps(9)).toBe("promoter");
    expect(classifyNps(10)).toBe("promoter");
    expect(classifyNps(8)).toBe("passive");
    expect(classifyNps(7)).toBe("passive");
    expect(classifyNps(6)).toBe("detractor");
    expect(classifyNps(0)).toBe("detractor");
  });

  it("clamps out-of-range values", () => {
    expect(classifyNps(11)).toBe("promoter");
    expect(classifyNps(-1)).toBe("detractor");
  });
});

describe("tallyNps", () => {
  it("computes segments and score = %promoters − %detractors", () => {
    const tally = tallyNps([9, 10, 7, 2]);
    expect(tally).toEqual({ promoters: 2, passives: 1, detractors: 1, total: 4, score: 25 });
  });

  it("scores 0 for an empty response set and ignores non-numbers", () => {
    expect(tallyNps([]).score).toBe(0);
    expect(tallyNps(["9" as unknown as number]).total).toBe(0);
  });
});

describe("summaryCountsOf", () => {
  it("hand-checked counts + completion rate on the fixture", () => {
    const counts = summaryCountsOf(FIXTURE_SUBMISSIONS);
    expect(counts).toEqual({
      total: 5,
      completed: 3,
      draft: 1,
      spam: 1,
      completionRate: 60,
    });
  });

  it("completion rate is 0 when there are no submissions", () => {
    expect(summaryCountsOf([]).completionRate).toBe(0);
  });
});

describe("aggregateBlock", () => {
  it("choice: counts per option + Other bucket (hand-checked)", () => {
    const agg = aggregateBlock(TEST_BLOCKS[1]!, FIXTURE_SUBMISSIONS);
    expect(agg.kind).toBe("choice");
    if (agg.kind !== "choice") return;
    expect(agg.totalResponses).toBe(3);
    expect(agg.distribution).toEqual([
      { optionId: "a", label: "Search", count: 1 },
      { optionId: "b", label: "Referral", count: 1 },
      { optionId: null, label: "Other", count: 1, isOther: true },
    ]);
  });

  it("multi-select: each option counted once per respondent (hand-checked)", () => {
    const agg = aggregateBlock(TEST_BLOCKS[2]!, FIXTURE_SUBMISSIONS);
    if (agg.kind !== "choice") throw new Error("expected choice aggregate");
    expect(agg.totalResponses).toBe(3);
    expect(agg.distribution.map((d) => d.count)).toEqual([2, 2, 1]);
  });

  it("rating: distribution covers 1..scale, average is hand-checked", () => {
    const agg = aggregateBlock(TEST_BLOCKS[3]!, FIXTURE_SUBMISSIONS);
    if (agg.kind !== "rating") throw new Error("expected rating aggregate");
    expect(agg.totalResponses).toBe(3);
    expect(agg.average).toBe(4);
    expect(agg.distribution.map((d) => d.count)).toEqual([0, 0, 1, 1, 1]);
  });

  it("rating scale falls back to 5 and clamps 3–10", () => {
    const agg = aggregateBlock(
      { id: "b_r2", kind: "rating", props: { label: "x", scale: 99 } },
      FIXTURE_SUBMISSIONS,
    );
    if (agg.kind !== "rating") throw new Error("expected rating aggregate");
    expect(agg.scale).toBe(10);
  });

  it("nps: segments + score from mixed answers (hand-checked)", () => {
    const agg = aggregateBlock(TEST_BLOCKS[4]!, FIXTURE_SUBMISSIONS);
    if (agg.kind !== "nps") throw new Error("expected nps aggregate");
    expect(agg.totalResponses).toBe(4);
    expect(agg.promoters).toBe(2);
    expect(agg.passives).toBe(1);
    expect(agg.detractors).toBe(1);
    expect(agg.score).toBe(25);
  });

  it("number: min/max/average (hand-checked)", () => {
    const agg = aggregateBlock(TEST_BLOCKS[5]!, FIXTURE_SUBMISSIONS);
    if (agg.kind !== "number") throw new Error("expected number aggregate");
    expect(agg.totalResponses).toBe(3);
    expect(agg.average).toBe(5);
    expect(agg.min).toBe(4);
    expect(agg.max).toBe(6);
  });

  it("text: skips empty answers, keeps three most recent strings", () => {
    const agg = aggregateBlock(TEST_BLOCKS[6]!, FIXTURE_SUBMISSIONS);
    if (agg.kind !== "text") throw new Error("expected text aggregate");
    // hand count: s1 "hello", s2 "world", s5 "asdf"; s3 "" is empty → skipped
    expect(agg.totalResponses).toBe(3);
    expect(agg.recent).toEqual(["hello", "world", "asdf"]);
  });
});

describe("aggregateSubmissions", () => {
  it("one aggregate per question block in document order; content blocks skipped", () => {
    const aggs = aggregateSubmissions(TEST_BLOCKS, FIXTURE_SUBMISSIONS);
    expect(aggs.map((a) => a.blockId)).toEqual([
      "b_source",
      "b_features",
      "b_rating",
      "b_nps",
      "b_number",
      "b_text",
    ]);
  });

  it("question blocks with zero responses are still listed", () => {
    const aggs = aggregateSubmissions(
      [{ id: "b_none", kind: "email", props: { label: "Email" } }],
      [],
    );
    expect(aggs).toHaveLength(1);
    expect(aggs[0]?.totalResponses).toBe(0);
  });

  it("walks children of layout blocks", () => {
    const aggs = aggregateSubmissions(
      [
        {
          id: "b_section",
          kind: "section",
          props: {},
          children: [{ id: "b_child", kind: "short-text", props: { label: "Child" } }],
        },
      ],
      [],
    );
    expect(aggs.map((a) => a.blockId)).toEqual(["b_child"]);
  });

  it("skips hidden question blocks", () => {
    const aggs = aggregateSubmissions(
      [{ id: "b_hidden", kind: "email", props: { label: "Email" }, hidden: true }],
      FIXTURE_SUBMISSIONS,
    );
    expect(aggs).toHaveLength(0);
  });
});

describe("buildSummary", () => {
  it("assembles counts + per-question aggregates with injected clock", () => {
    const summary = buildSummary(TEST_BLOCKS, FIXTURE_SUBMISSIONS, FIXED_NOW);
    expect(summary.generatedAt).toBe(FIXED_NOW);
    expect(summary.counts.total).toBe(5);
    expect(summary.blocks).toHaveLength(6);
    const nps = summary.blocks.find((b) => b.blockId === "b_nps");
    expect(nps && nps.kind === "nps" && nps.score).toBe(25);
  });
});
