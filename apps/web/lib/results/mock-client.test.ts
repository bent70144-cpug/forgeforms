import { describe, expect, it } from "vitest";
import { buildFixtureSubmissions, FIXTURE_BLOCK_IDS, FIXTURE_DOCUMENT, FIXTURE_SUBMISSION_COUNT } from "./fixtures";
import { MockResultsClient } from "./mock-client";
import { ResultsApiError } from "./client";
import { summaryCountsOf } from "./aggregate";
import { isQuestionBlock } from "./format";

const FIXED_NOW = Date.parse("2026-11-06T12:00:00.000Z");

function client() {
  return new MockResultsClient({ now: () => FIXED_NOW });
}

describe("fixtures", () => {
  it("are deterministic for a fixed clock", () => {
    const a = buildFixtureSubmissions({ now: FIXED_NOW });
    const b = buildFixtureSubmissions({ now: FIXED_NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produce the expected volume, newest-first, valid statuses", () => {
    const rows = buildFixtureSubmissions({ now: FIXED_NOW });
    expect(rows).toHaveLength(FIXTURE_SUBMISSION_COUNT);
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1]!;
      const curr = rows[i]!;
      expect((prev.completedAt ?? prev.startedAt).localeCompare(curr.completedAt ?? curr.startedAt)).toBeGreaterThanOrEqual(0);
    }
    for (const row of rows) {
      expect(["draft", "completed", "spam"]).toContain(row.status);
      if (row.status === "draft") expect(row.completedAt).toBeNull();
      const nps = row.answers[FIXTURE_BLOCK_IDS.nps];
      if (nps !== undefined) {
        expect(typeof nps).toBe("number");
        expect(nps as number).toBeGreaterThanOrEqual(0);
        expect(nps as number).toBeLessThanOrEqual(10);
      }
    }
  });

  it("cover all three statuses", () => {
    const counts = summaryCountsOf(buildFixtureSubmissions({ now: FIXED_NOW }));
    expect(counts.completed).toBeGreaterThan(0);
    expect(counts.draft).toBeGreaterThan(0);
    expect(counts.spam).toBeGreaterThan(0);
    expect(counts.total).toBe(FIXTURE_SUBMISSION_COUNT);
  });
});

describe("MockResultsClient — cursor pagination (spec §4)", () => {
  it("pages through the whole table without duplicates or loss", async () => {
    const c = client();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await c.listSubmissions("doc_1", { limit: 50, cursor, sort: "newest" });
      seen.push(...res.data.map((r) => r.id));
      cursor = res.nextCursor;
      pages += 1;
      expect(res.data.length).toBeLessThanOrEqual(50);
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3); // 137 rows / 50
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(FIXTURE_SUBMISSION_COUNT);
  });

  it("respects the status filter and its total", async () => {
    const c = client();
    const all = buildFixtureSubmissions({ now: FIXED_NOW });
    const expectedCompleted = all.filter((r) => r.status === "completed").length;
    const first = await c.listSubmissions("doc_1", { limit: 500, status: "completed" });
    expect(first.data).toHaveLength(expectedCompleted);
    expect(first.data.every((r) => r.status === "completed")).toBe(true);
    expect(first.nextCursor).toBeNull();
  });

  it("binds cursors to filter+sort: reuse with different params → VALIDATION", async () => {
    const c = client();
    const first = await c.listSubmissions("doc_1", { limit: 50, status: "completed" });
    expect(first.nextCursor).not.toBeNull();
    await expect(
      c.listSubmissions("doc_1", { limit: 50, cursor: first.nextCursor, status: "all" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      c.listSubmissions("doc_1", { limit: 50, cursor: first.nextCursor, status: "completed", sort: "oldest" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects malformed cursors with VALIDATION", async () => {
    const c = client();
    await expect(c.listSubmissions("doc_1", { cursor: "not-a-cursor" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("sorts oldest-first on demand", async () => {
    const c = client();
    const res = await c.listSubmissions("doc_1", { limit: 2, sort: "oldest" });
    const first = res.data[0]!;
    const second = res.data[1]!;
    const keyOf = (r: typeof first) => r.completedAt ?? r.startedAt;
    expect(keyOf(first).localeCompare(keyOf(second))).toBeLessThanOrEqual(0);
  });
});

describe("MockResultsClient — detail + summary", () => {
  it("returns a submission by id and 404s otherwise", async () => {
    const c = client();
    const all = buildFixtureSubmissions({ now: FIXED_NOW });
    const probe = all[10]!;
    const got = await c.getSubmission("doc_1", probe.id);
    expect(got.id).toBe(probe.id);
    expect(got.publicToken).toBe(probe.publicToken);
    await expect(c.getSubmission("doc_1", "sub_missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("serves the fixture document", async () => {
    const c = client();
    const doc = await c.getDocument("doc_1");
    expect(doc).toEqual(FIXTURE_DOCUMENT);
  });

  it("summary aggregates match summaryCountsOf and list every question block", async () => {
    const c = client();
    const summary = await c.getSummary("doc_1");
    const rows = buildFixtureSubmissions({ now: FIXED_NOW });
    expect(summary.counts).toEqual(summaryCountsOf(rows));
    const questionBlocks = FIXTURE_DOCUMENT.body.blocks.filter((b) => isQuestionBlock(b));
    expect(summary.blocks.map((b) => b.blockId)).toEqual(questionBlocks.map((b) => b.id));
    const nps = summary.blocks.find((b) => b.kind === "nps");
    expect(nps && nps.kind === "nps" && nps.totalResponses).toBeGreaterThan(0);
  });

  it("honours artificial latency (loading states are exercisable)", async () => {
    const c = new MockResultsClient({ latencyMs: 15, now: () => FIXED_NOW });
    const t0 = Date.now();
    await c.getDocument("doc_1");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10);
  });

  it("throws ResultsApiError (never raw strings)", async () => {
    const c = client();
    try {
      await c.getSubmission("doc_1", "sub_missing");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ResultsApiError);
    }
  });
});
