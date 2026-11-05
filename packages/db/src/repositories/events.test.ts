// Events repository tests — T17 (issue #17) acceptance: "exactly-once event
// insert". Postgres is unavailable in the sandbox, so the QueryFn is scripted:
// these tests pin the SQL CONTRACT (parameterized + on conflict do nothing)
// and the row mapping, which is what the T02 integration must satisfy.
import { describe, expect, it } from "vitest";
import { createEventsRepository, type QueryFn } from "./events";

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

const ROW = {
  id: "evt-1",
  workspace_id: "ws-1",
  type: "submission.completed",
  document_id: "doc-1",
  payload: { id: "evt-1", type: "submission.completed" },
  occurred_at: "2026-11-06T10:00:00.000Z",
  processed_at: null,
};

describe("insertEventOnce (exactly-once)", () => {
  it("inserts with ON CONFLICT DO NOTHING and reports created on first insert", async () => {
    const { query, calls } = scriptedQuery([[{ id: "evt-1" }]]);
    const repo = createEventsRepository(query);

    const outcome = await repo.insertEventOnce({
      id: "evt-1",
      workspaceId: "ws-1",
      type: "submission.completed",
      documentId: "doc-1",
      payload: { id: "evt-1" },
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });

    expect(outcome).toEqual({ created: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("on conflict (id) do nothing");
    expect(calls[0]?.params).toEqual([
      "evt-1",
      "ws-1",
      "submission.completed",
      "doc-1",
      JSON.stringify({ id: "evt-1" }),
      new Date("2026-11-06T10:00:00.000Z"),
    ]);
  });

  it("reports created: false when a redelivered event already exists (no rows returned)", async () => {
    const { query } = scriptedQuery([[]]);
    const repo = createEventsRepository(query);
    const outcome = await repo.insertEventOnce({
      id: "evt-1",
      workspaceId: "ws-1",
      type: "submission.completed",
      documentId: "doc-1",
      payload: {},
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
    });
    expect(outcome).toEqual({ created: false });
  });
});

describe("row mapping", () => {
  it("maps snake_case rows to camelCase with Date coercion", async () => {
    const { query } = scriptedQuery([[ROW]]);
    const repo = createEventsRepository(query);
    const event = await repo.getEvent("evt-1");
    expect(event).toEqual({
      id: "evt-1",
      workspaceId: "ws-1",
      type: "submission.completed",
      documentId: "doc-1",
      payload: ROW.payload,
      occurredAt: new Date("2026-11-06T10:00:00.000Z"),
      processedAt: null,
    });
  });

  it("returns null for a missing event", async () => {
    const { query } = scriptedQuery([[]]);
    const repo = createEventsRepository(query);
    expect(await repo.getEvent("nope")).toBeNull();
  });

  it("markEventProcessed updates processed_at by id", async () => {
    const { query, calls } = scriptedQuery([[]]);
    const repo = createEventsRepository(query);
    const at = new Date("2026-11-06T11:00:00.000Z");
    await repo.markEventProcessed("evt-1", at);
    expect(calls[0]?.sql).toContain("set processed_at = $2");
    expect(calls[0]?.params).toEqual(["evt-1", at]);
  });
});
