// T15 — component tests for the summary chart primitives (issue #15 AC:
// "Aggregates match hand-computed fixture (unit + component tests)").
// Rendered with react-dom/server — no extra test dependencies, no DOM env.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SummaryCounts } from "../../lib/results";
import { BarList } from "./BarList";
import { NpsBar } from "./NpsBar";
import { StatCards } from "./StatCards";
import { StatusPill } from "./StatusPill";

const COUNTS: SummaryCounts = {
  total: 40,
  completed: 34,
  draft: 4,
  spam: 2,
  completionRate: 85,
};

describe("<StatCards>", () => {
  it("renders hand-computed response count + completion rate cards", () => {
    const html = renderToStaticMarkup(h(StatCards, { counts: COUNTS }));
    expect(html).toContain("Responses");
    expect(html).toContain("34"); // completed
    expect(html).toContain("40 total submissions");
    expect(html).toContain("85%"); // completion rate
    expect(html).toContain("In progress");
    expect(html).toContain("Spam");
  });
});

describe("<NpsBar>", () => {
  it("renders hand-computed NPS segments and score (5 promoters, 2 passives, 3 detractors → 20)", () => {
    const aggregate = {
      kind: "nps" as const,
      blockId: "b_nps",
      label: "How likely are you to recommend FormForge?",
      totalResponses: 10,
      promoters: 5,
      passives: 2,
      detractors: 3,
      score: 5 * 10 - 3 * 10, // %promoters − %detractors = 20
    };
    const html = renderToStaticMarkup(h(NpsBar, { aggregate }));
    expect(html).toContain("NPS");
    expect(html).toContain("20");
    expect(html).toContain("Promoters");
    expect(html).toContain("5 · 50%");
    expect(html).toContain("Passives");
    expect(html).toContain("2 · 20%");
    expect(html).toContain("Detractors");
    expect(html).toContain("3 · 30%");
  });

  it("renders zero-state segments without NaN widths", () => {
    const aggregate = {
      kind: "nps" as const,
      blockId: "b_nps",
      label: "NPS",
      totalResponses: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      score: 0,
    };
    const html = renderToStaticMarkup(h(NpsBar, { aggregate }));
    expect(html).not.toContain("NaN");
    expect(html).toContain("width:0%");
  });
});

describe("<BarList>", () => {
  it("renders choice distribution bars with counts and shares", () => {
    const html = renderToStaticMarkup(
      h(BarList, {
        ariaLabel: "Distribution for How did you hear about us?",
        items: [
          { label: "Search engine", value: 6 },
          { label: "Referral", value: 3 },
          { label: "Podcast", value: 1 },
        ],
      }),
    );
    expect(html).toContain("Search engine");
    expect(html).toContain("Referral");
    expect(html).toContain("Podcast");
    expect(html).toContain("6 (60%)");
    expect(html).toContain("3 (30%)");
    expect(html).toContain("1 (10%)");
  });

  it("renders zero values without NaN", () => {
    const html = renderToStaticMarkup(
      h(BarList, { ariaLabel: "Empty", items: [{ label: "Nothing", value: 0 }] }),
    );
    expect(html).not.toContain("NaN");
    expect(html).toContain("0");
  });
});

describe("<StatusPill>", () => {
  it("maps each submission status to its label", () => {
    expect(renderToStaticMarkup(h(StatusPill, { status: "completed" }))).toContain("Completed");
    expect(renderToStaticMarkup(h(StatusPill, { status: "draft" }))).toContain("Draft");
    expect(renderToStaticMarkup(h(StatusPill, { status: "spam" }))).toContain("Spam");
  });
});
