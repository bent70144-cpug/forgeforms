// Webhooks repository tests — T17 (issue #17): delivery-log recording,
// consecutive-failure counting (auto-disable input) and endpoint disable are
// the SQL contract the worker relies on. QueryFn is scripted (no Postgres in
// the sandbox); row mapping + parameterization are pinned here.
import { describe, expect, it } from "vitest";
import { createWebhooksRepository, type QueryFn } from "./webhooks";

type Call = { sql: string; params: unknown[] };

function scriptedQuery(responses: unknown[][]): { query: QueryFn; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push({ sql, params });
    const next = responses[i];
    i += 1;
    return (next ?? []) as T[];
  };
  return { query, calls };
}

const ENDPOINT_ROW = {
  id: "wh-1",
  workspace_id: "ws-1",
  document_id: null,
  url: "https://consumer.example.com/hook",
  secret: "whsec_x",
  events: ["submission.completed"],
  enabled: true,
  created_at: "2026-11-01T00:00:00.000Z",
};

describe("recordDelivery (every attempt logged)", () => {
  it("inserts a parameterized row and maps the result", async () => {
    const returned = {
      id: "d1",
      webhook_id: "wh-1",
      event_id: "evt-1",
      attempt: 2,
      status_code: 500,
      ok: false,
      duration_ms: 123,
      error: "http 500",
      created_at: "2026-11-06T10:05:00.000Z",
    };
    const { query, calls } = scriptedQuery([[returned]]);
    const repo = createWebhooksRepository(query);

    const row = await repo.recordDelivery({
      id: "d1",
      webhookId: "wh-1",
      eventId: "evt-1",
      attempt: 2,
      statusCode: 500,
      ok: false,
      durationMs: 123,
      error: "http 500",
    });

    expect(row).toEqual({
      id: "d1",
      webhookId: "wh-1",
      eventId: "evt-1",
      attempt: 2,
      statusCode: 500,
      ok: false,
      durationMs: 123,
      error: "http 500",
      createdAt: new Date("2026-11-06T10:05:00.000Z"),
    });
    expect(calls[0]?.sql).toContain("on conflict (id) do nothing");
    expect(calls[0]?.params).toEqual(["d1", "wh-1", "evt-1", 2, 500, false, 123, "http 500"]);
  });

  it("returns null when the insert conflicts (duplicate attempt id)", async () => {
    const { query } = scriptedQuery([[]]);
    const repo = createWebhooksRepository(query);
    const row = await repo.recordDelivery({
      id: "d1",
      webhookId: "wh-1",
      eventId: "evt-1",
      attempt: 0,
      statusCode: 200,
      ok: true,
      durationMs: 5,
      error: null,
    });
    expect(row).toBeNull();
  });
});

describe("countConsecutiveFailures (newest → oldest, stop at first success)", () => {
  it("counts failures back to the last success", async () => {
    const { query } = scriptedQuery([[{ ok: false }, { ok: false }, { ok: true }, { ok: false }]]);
    const repo = createWebhooksRepository(query);
    expect(await repo.countConsecutiveFailures("wh-1")).toBe(2);
  });

  it("counts all when every recent attempt failed (auto-disable input reaches 10)", async () => {
    const { query, calls } = scriptedQuery([[
      { ok: false }, { ok: false }, { ok: false }, { ok: false }, { ok: false },
      { ok: false }, { ok: false }, { ok: false }, { ok: false }, { ok: false },
    ]]);
    const repo = createWebhooksRepository(query);
    expect(await repo.countConsecutiveFailures("wh-1")).toBe(10);
    // The window itself is capped at the threshold (10) — never unbounded.
    expect(calls[0]?.sql).toContain("limit $2");
    expect(calls[0]?.params).toEqual(["wh-1", 10]);
  });

  it("is zero when the newest attempt succeeded", async () => {
    const { query } = scriptedQuery([[{ ok: true }, { ok: false }]]);
    const repo = createWebhooksRepository(query);
    expect(await repo.countConsecutiveFailures("wh-1")).toBe(0);
  });
});

describe("endpoints", () => {
  it("listActiveEndpoints is parameterized and includes workspace-wide rows", async () => {
    const { query, calls } = scriptedQuery([[ENDPOINT_ROW]]);
    const repo = createWebhooksRepository(query);
    const endpoints = await repo.listActiveEndpoints({
      workspaceId: "ws-1",
      documentId: "doc-1",
      eventType: "submission.completed",
    });
    expect(endpoints).toEqual([
      {
        id: "wh-1",
        workspaceId: "ws-1",
        documentId: null,
        url: "https://consumer.example.com/hook",
        secret: "whsec_x",
        events: ["submission.completed"],
        enabled: true,
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
      },
    ]);
    expect(calls[0]?.params).toEqual(["ws-1", "doc-1", "submission.completed"]);
    expect(calls[0]?.sql).toContain("enabled = true");
    expect(calls[0]?.sql).toContain("document_id is null or document_id = $2");
  });

  it("disableEndpoint returns true only when it flipped enabled → false", async () => {
    const first = scriptedQuery([[{ id: "wh-1" }]]);
    const second = scriptedQuery([[]]);
    expect(await createWebhooksRepository(first.query).disableEndpoint("wh-1")).toBe(true);
    expect(await createWebhooksRepository(second.query).disableEndpoint("wh-1")).toBe(false);
    expect(first.calls[0]?.sql).toContain("enabled = false");
    expect(first.calls[0]?.sql).toContain("and enabled = true");
  });
});
