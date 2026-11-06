// T29 (spec §17 GDPR) — retention + workspace purge job tests (DB-free:
// in-memory gdpr stores from @formforge/core/gdpr/testing).
import { describe, expect, it } from "vitest";
import { createInMemoryGdprStores } from "@formforge/core/gdpr";
import { processRetentionPurge, type RetentionPurgeDeps } from "./retention-purge";

const T0 = Date.parse("2026-11-06T04:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function makeDeps() {
  const stores = createInMemoryGdprStores(); // stores.state is the live in-memory state
  const deps: RetentionPurgeDeps = {
    logger,
    gdpr: { retention: stores.retention, workspaces: stores.workspaces, workspaceGraceDays: 30 },
  };
  return { deps, state: stores.state };
}

function seed(state: ReturnType<typeof createInMemoryGdprStores>["state"]): void {
  state.workspaces.set("ws_old", { id: "ws_old", name: "Old", slug: "old", createdAt: null, deletedAt: new Date(T0 - 40 * DAY) });
  state.workspaces.set("ws_fresh", { id: "ws_fresh", name: "Fresh", slug: "fresh", createdAt: null, deletedAt: new Date(T0 - 1 * DAY) });
  state.workspaces.set("ws_live", { id: "ws_live", name: "Live", slug: "live", createdAt: null, deletedAt: null });
  // listRetainedDocuments reads documents + the retentionDays map.
  state.documents.set("ws_old", [
    { id: "doc_30", type: "form", title: "30d", slug: "30d", status: "published", draft: {}, createdAt: null, updatedAt: null },
  ]);
  state.retentionDays.set("doc_30", 30);
  state.submissions.set("ws_old", [
    {
      id: "sub_expired", workspaceId: "ws_old", documentId: "doc_30", status: "completed",
      startedAt: new Date(T0 - 60 * DAY), completedAt: new Date(T0 - 60 * DAY),
      variables: {}, hidden: {}, meta: {}, answers: [{ blockId: "q1", value: "stale" }],
    },
    {
      id: "sub_new", workspaceId: "ws_old", documentId: "doc_30", status: "completed",
      startedAt: new Date(T0 - 2 * DAY), completedAt: new Date(T0 - 2 * DAY),
      variables: {}, hidden: {}, meta: {}, answers: [],
    },
  ]);
}

describe("processRetentionPurge (maintenance job, spec §17 GDPR)", () => {
  it("purges expired submission data AND workspaces past their grace window", async () => {
    const { deps, state } = makeDeps();
    seed(state);

    const result = await processRetentionPurge(deps, "job-1", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.retention).toEqual({ documentsScanned: 1, submissionsDeleted: 1, answersDeleted: 1 });
    // ws_old requested 40 days ago > 30-day grace → purged; ws_fresh stays.
    expect(result.value.workspaces.purged).toBe(1);
    // The fresh workspace's data survives.
    expect(state.submissions.get("ws_fresh") ?? []).toEqual([]);
  });

  it("keeps in-progress (draft) submissions and recent completions", async () => {
    const { deps, state } = makeDeps();
    seed(state);
    state.submissions.set("ws_live", [
      {
        id: "sub_draft", workspaceId: "ws_live", documentId: "doc_30", status: "draft",
        startedAt: new Date(T0 - 90 * DAY), completedAt: null, variables: {}, hidden: {}, meta: {}, answers: [],
      },
      {
        id: "sub_recent", workspaceId: "ws_live", documentId: "doc_30", status: "completed",
        startedAt: new Date(T0 - 2 * DAY), completedAt: new Date(T0 - 2 * DAY),
        variables: {}, hidden: {}, meta: {}, answers: [],
      },
    ]);

    const result = await processRetentionPurge(deps, "job-2", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = (state.submissions.get("ws_live") ?? []).map((s) => s.id).sort();
    expect(ids).toEqual(["sub_draft", "sub_recent"]);
    expect(result.value.retention.documentsScanned).toBe(1);
    // Only the ws_old expired submission was deleted this run.
    expect(result.value.retention.submissionsDeleted).toBe(1);
  });

  it("is idempotent — a second run purges nothing new", async () => {
    const { deps, state } = makeDeps();
    seed(state);
    await processRetentionPurge(deps, "job-3", {});
    const second = await processRetentionPurge(deps, "job-4", {});
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // ws_old (the only retained document's owner) was hard-purged in run 1 —
    // nothing is left to scan, nothing new is deleted. Re-running is safe.
    expect(second.value.retention).toEqual({ documentsScanned: 0, submissionsDeleted: 0, answersDeleted: 0 });
    expect(second.value.workspaces.purged).toBe(0);
  });

  it("fails loudly when the gdpr stores are not wired (never silently no-ops)", async () => {
    const result = await processRetentionPurge({ logger }, "job-5", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL");
    expect(result.error.message).toContain("gdpr stores not wired");
  });
});
