import { describe, expect, it } from "vitest";
import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { executeToolCall } from "../src/pipeline.ts";
import { buildToolDefinitions, toolMap } from "../src/tools.ts";
import type { FormForgeMcpDeps } from "../src/services.ts";
import {
  ALL_SCOPES,
  FakeDocuments,
  FakeSubmissions,
  FakeTokens,
  TOKEN_A,
  TOKEN_B,
  TOKEN_ID_A,
  TOKEN_ID_B,
  WORKSPACE_A,
  WORKSPACE_B,
  fixedNow,
  makeDeps,
  makeDocumentBody,
  seedDoc,
  tokenFor,
} from "./fakes.ts";
import type { FakeSubmissionRow } from "./fakes.ts";

function setup(overrides: Partial<FormForgeMcpDeps> = {}) {
  const bundle = makeDeps(overrides);
  const tools = toolMap(buildToolDefinitions(bundle.deps));
  return {
    ...bundle,
    call: (name: string, args: unknown, rawToken?: string) =>
      executeToolCall(
        rawToken === undefined ? bundle.deps : { ...bundle.deps, rawToken },
        tools,
        name,
        args,
        "req-test-1",
      ),
  };
}

// Tests assert dynamically-shaped payloads; `any` is intentional here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(result: CallToolResult): Record<string, any> {
  const content = result.content[0] as TextContent | undefined;
  expect(content?.type).toBe("text");
  return JSON.parse(content?.text ?? "");
}

const seedWorkspaceA = () => [
  seedDoc({ id: "doc_a1", title: "Contact form", updatedAt: new Date("2026-11-05T10:00:00Z") }),
  seedDoc({
    id: "doc_a2",
    title: "Feedback survey",
    type: "page" as const,
    updatedAt: new Date("2026-11-04T10:00:00Z"),
  }),
];

describe("list_documents", () => {
  it("returns a tenant-scoped page and audits the call", async () => {
    const t = setup({ documents: new FakeDocuments([...seedWorkspaceA(), seedDoc({ id: "doc_b1", workspaceId: WORKSPACE_B })]) });
    const result = await t.call("list_documents", {});
    expect(result.isError).toBeFalsy();
    const body = payload(result);
    expect(body.data.map((d: { id: string }) => d.id)).toEqual(["doc_a1", "doc_a2"]);
    expect(body.nextCursor).toBeNull();

    const [entry] = t.audit.entries;
    expect(entry).toMatchObject({
      action: "list_documents",
      status: "ok",
      workspaceId: WORKSPACE_A,
      actorType: "mcp",
      actorId: TOKEN_ID_A,
      target: null,
    });
    expect(entry?.createdAt).toEqual(fixedNow());
  });

  it("passes a spec §3 Ctx to the service (workspace from token, actor 'mcp')", async () => {
    const docs = new FakeDocuments(seedWorkspaceA());
    const t = setup({ documents: docs });
    await t.call("list_documents", { type: "form", status: "draft", q: "contact", limit: 10 });
    const seen = docs.seenCtx[0];
    expect(seen?.op).toBe("listDocuments");
    expect(seen?.ctx).toMatchObject({
      workspaceId: WORKSPACE_A,
      actor: { type: "mcp", id: TOKEN_ID_A },
      requestId: "req-test-1",
    });
    expect(seen?.ctx.now()).toEqual(fixedNow());
  });

  it("paginates with an opaque cursor", async () => {
    const t = setup({ documents: new FakeDocuments(seedWorkspaceA()) });
    const page1 = payload(await t.call("list_documents", { limit: 1 }));
    expect(page1.data).toHaveLength(1);
    expect(page1.nextCursor).toBe("doc_a1");

    const page2 = payload(await t.call("list_documents", { limit: 1, cursor: page1.nextCursor }));
    expect(page2.data.map((d: { id: string }) => d.id)).toEqual(["doc_a2"]);
    expect(page2.nextCursor).toBeNull();
  });
});

describe("get_document", () => {
  it("returns metadata + draft body", async () => {
    const doc = seedDoc({ id: "doc_a1" });
    const t = setup({ documents: new FakeDocuments([doc]) });
    const result = await t.call("get_document", { documentId: "doc_a1" });
    expect(result.isError).toBeFalsy();
    const body = payload(result);
    expect(body.id).toBe("doc_a1");
    expect(body.rev).toBe(0);
    expect(body.draft).toMatchObject({ schemaVersion: 1, type: "form" });
    expect(t.audit.entries[0]?.target).toBe("doc_a1");
  });

  it("rejects a cross-workspace document id with FORBIDDEN and audits the failure", async () => {
    const t = setup({
      documents: new FakeDocuments([seedDoc({ id: "doc_b1", workspaceId: WORKSPACE_B })]),
    });
    const result = await t.call("get_document", { documentId: "doc_b1" });
    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({
      error: { code: "FORBIDDEN", message: expect.stringContaining("another workspace"), details: [] },
    });
    expect(t.audit.entries).toHaveLength(1);
    expect(t.audit.entries[0]).toMatchObject({
      action: "get_document",
      status: "error",
      errorCode: "FORBIDDEN",
      target: "doc_b1",
      workspaceId: WORKSPACE_A,
    });
  });

  it("returns NOT_FOUND for unknown ids", async () => {
    const t = setup();
    const result = await t.call("get_document", { documentId: "doc_nope" });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("NOT_FOUND");
  });
});

describe("create_document", () => {
  it("creates a document with a validated body and audits the new id as target", async () => {
    const t = setup();
    const body = makeDocumentBody({ type: "form" });
    const result = await t.call("create_document", { type: "form", title: "RSVP", body });
    expect(result.isError).toBeFalsy();
    const created = payload(result);
    expect(created.status).toBe("draft");
    expect(created.rev).toBe(0);
    expect(created.draft).toEqual(body);
    expect(t.documents.rows).toHaveLength(1);
    expect(t.audit.entries[0]).toMatchObject({
      action: "create_document",
      status: "ok",
      target: created.id,
    });
  });

  it("creates from an empty draft when no body is given", async () => {
    const t = setup();
    const created = payload(await t.call("create_document", { type: "page", title: "Home" }));
    expect(created.draft).toMatchObject({ schemaVersion: 1, type: "page", blocks: [] });
    expect(created.slug).toBe("home");
  });

  it("validates DocumentBody BEFORE calling the service (VALIDATION, audited, no write)", async () => {
    const t = setup();
    const result = await t.call("create_document", {
      type: "form",
      title: "Bad",
      // Issue paths are relative to the tool arguments, hence the `body.` prefix.
      body: { schemaVersion: 99, type: "form", theme: { tokens: {} }, settings: {}, blocks: [] },
    });
    expect(result.isError).toBe(true);
    const error = payload(result).error;
    expect(error.code).toBe("VALIDATION");
    expect(error.details).toEqual([expect.objectContaining({ path: "body.schemaVersion" })]);
    expect(t.documents.seenCtx).toHaveLength(0); // service never reached
    expect(t.documents.rows).toHaveLength(0);
    expect(t.audit.entries[0]).toMatchObject({
      action: "create_document",
      status: "error",
      errorCode: "VALIDATION",
      target: null,
    });
  });

  it("surfaces slug conflicts as CONFLICT", async () => {
    const t = setup({ documents: new FakeDocuments([seedDoc({ id: "doc_a1", slug: "contact-form" })]) });
    const result = await t.call("create_document", { type: "form", title: "Contact form" });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("CONFLICT");
  });
});

describe("apply_ops", () => {
  it("applies ops with baseRev and increments the revision", async () => {
    const doc = seedDoc({ id: "doc_a1" });
    const t = setup({ documents: new FakeDocuments([doc]) });
    const result = await t.call("apply_ops", {
      documentId: "doc_a1",
      baseRev: 0,
      ops: [{ op: "meta.update", patch: { title: "Renamed form" } }],
    });
    expect(result.isError).toBeFalsy();
    const updated = payload(result);
    expect(updated.rev).toBe(1);
    expect(updated.title).toBe("Renamed form");
    expect(t.audit.entries[0]).toMatchObject({ action: "apply_ops", status: "ok", target: "doc_a1" });
  });

  it("applies block ops against the draft body", async () => {
    const doc = seedDoc({
      id: "doc_a1",
      draft: makeDocumentBody({ blocks: [{ id: "b1", kind: "short-text", props: { label: "Name" } }] }),
    });
    const t = setup({ documents: new FakeDocuments([doc]) });
    const updated = payload(
      await t.call("apply_ops", {
        documentId: "doc_a1",
        baseRev: 0,
        ops: [{ op: "block.update", id: "b1", props: { label: "Full name" } }],
      }),
    );
    expect(updated.draft.blocks[0]?.props).toMatchObject({ label: "Full name" });
  });

  it("rejects stale baseRev with CONFLICT", async () => {
    const doc = seedDoc({ id: "doc_a1", rev: 3 });
    const t = setup({ documents: new FakeDocuments([doc]) });
    const result = await t.call("apply_ops", {
      documentId: "doc_a1",
      baseRev: 0,
      ops: [{ op: "meta.update", patch: { title: "x" } }],
    });
    expect(result.isError).toBe(true);
    const error = payload(result).error;
    expect(error.code).toBe("CONFLICT");
    expect(error.details).toEqual([{ path: "baseRev", message: "current revision is 3" }]);
    expect(t.audit.entries[0]).toMatchObject({ status: "error", errorCode: "CONFLICT" });
  });

  it("rejects malformed ops with VALIDATION before the service is called", async () => {
    const t = setup();
    const result = await t.call("apply_ops", {
      documentId: "doc_a1",
      baseRev: 0,
      ops: [{ type: "workspace.purge" }],
    });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("VALIDATION");
    expect(t.documents.seenCtx).toHaveLength(0);
    expect(t.audit.entries[0]).toMatchObject({ status: "error", errorCode: "VALIDATION" });
  });

  it("fails closed (INTERNAL) if the service returned an invalid DocumentBody", async () => {
    const docs = new FakeDocuments([seedDoc({ id: "doc_a1" })]);
    docs.corruptNextApplyOps = true;
    const t = setup({ documents: docs });
    const result = await t.call("apply_ops", {
      documentId: "doc_a1",
      baseRev: 0,
      ops: [{ op: "meta.update", patch: { title: "x" } }],
    });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("INTERNAL");
    expect(t.audit.entries[0]).toMatchObject({ status: "error", errorCode: "INTERNAL" });
  });
});

describe("publish_document", () => {
  it("publishes and audits with the document as target", async () => {
    const t = setup({ documents: new FakeDocuments([seedDoc({ id: "doc_a1" })]) });
    const result = await t.call("publish_document", { documentId: "doc_a1" });
    expect(result.isError).toBeFalsy();
    const published = payload(result);
    expect(published).toMatchObject({ id: "doc_a1", status: "published" });
    expect(published.publishedVersionId).toBeTruthy();
    expect(t.audit.entries[0]).toMatchObject({ action: "publish_document", status: "ok", target: "doc_a1" });
  });

  it("rejects cross-workspace ids with FORBIDDEN", async () => {
    const t = setup({
      documents: new FakeDocuments([seedDoc({ id: "doc_b1", workspaceId: WORKSPACE_B })]),
    });
    const result = await t.call("publish_document", { documentId: "doc_b1" });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("FORBIDDEN");
  });
});

describe("list_submissions", () => {
  const submission = (over: Partial<FakeSubmissionRow>): FakeSubmissionRow => ({
    id: "sub_1",
    documentId: "doc_a1",
    workspaceId: WORKSPACE_A,
    versionId: "ver_1",
    status: "completed",
    completedAt: "2026-11-05T10:00:00.000Z",
    answers: { q_email: { label: "Email", value: "a@b.co" } },
    variables: {},
    hidden: { utm: "newsletter" },
    ...over,
  });

  it("returns labelled answers for the workspace's document", async () => {
    const t = setup({
      submissions: new FakeSubmissions([submission({ id: "sub_1" }), submission({ id: "sub_2", workspaceId: WORKSPACE_B, documentId: "doc_b1" })]),
    });
    const result = await t.call("list_submissions", { documentId: "doc_a1" });
    expect(result.isError).toBeFalsy();
    const body = payload(result);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.answers.q_email).toEqual({ label: "Email", value: "a@b.co" });
    expect(body.data[0]?.workspaceId).toBeUndefined(); // internal field stripped
    expect(t.audit.entries[0]).toMatchObject({ action: "list_submissions", status: "ok", target: "doc_a1" });
  });

  it("rejects a cross-workspace document id with FORBIDDEN", async () => {
    const t = setup({
      submissions: new FakeSubmissions([submission({ id: "sub_b1", workspaceId: WORKSPACE_B, documentId: "doc_b1" })]),
    });
    const result = await t.call("list_submissions", { documentId: "doc_b1" });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("FORBIDDEN");
    expect(t.audit.entries[0]).toMatchObject({ status: "error", errorCode: "FORBIDDEN", target: "doc_b1" });
  });

  it("returns NOT_FOUND for documents without submissions", async () => {
    const t = setup();
    const result = await t.call("list_submissions", { documentId: "doc_missing" });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("NOT_FOUND");
  });
});

describe("summarize_responses", () => {
  it("aggregates per-question stats and NPS", async () => {
    const answers = (email: string, score: number) => ({
      q_email: { label: "Email", value: email },
      q_score: { label: "Score", value: score },
    });
    const t = setup({
      submissions: new FakeSubmissions(
        [
          submissionRow("sub_1", answers("a@b.co", 9)),
          submissionRow("sub_2", answers("c@d.co", 0)),
          submissionRow("sub_3", answers("e@f.co", 5), { status: "draft" as const }),
        ],
        { questionKinds: { q_score: "nps" } },
      ),
    });
    const result = await t.call("summarize_responses", { documentId: "doc_a1" });
    expect(result.isError).toBeFalsy();
    const body = payload(result);
    expect(body.total).toBe(3);
    expect(body.completed).toBe(2);
    expect(body.nps).toEqual({ promoters: 1, passives: 0, detractors: 1, responses: 2, score: 0 });
    const score = body.perQuestion.find((q: { blockId: string }) => q.blockId === "q_score");
    expect(score?.answered).toBe(2);
    expect(body.perQuestion.find((q: { blockId: string }) => q.blockId === "q_email")?.distribution).toBeDefined();
    expect(t.audit.entries[0]).toMatchObject({ action: "summarize_responses", status: "ok", target: "doc_a1" });
  });

  function submissionRow(
    id: string,
    answers: Record<string, { label: string; value: unknown }>,
    over: Partial<FakeSubmissionRow> = {},
  ): FakeSubmissionRow {
    return {
      id,
      documentId: "doc_a1",
      workspaceId: WORKSPACE_A,
      versionId: "ver_1",
      status: "completed",
      completedAt: "2026-11-05T10:00:00.000Z",
      answers,
      variables: {},
      hidden: {},
      ...over,
    };
  }
});

describe("authorization and audit guarantees", () => {
  it("rejects calls when the token lacks the required scope (FORBIDDEN, audited, no service call)", async () => {
    const t = setup({
      tokens: new FakeTokens({ [TOKEN_A]: tokenFor(TOKEN_ID_A, WORKSPACE_A, ["docs:read"]) }),
    });
    const result = await t.call("create_document", { type: "form", title: "Nope" });
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("FORBIDDEN");
    expect(payload(result).error.message).toContain("docs:write");
    expect(t.documents.seenCtx).toHaveLength(0);
    expect(t.audit.entries[0]).toMatchObject({
      action: "create_document",
      status: "error",
      errorCode: "FORBIDDEN",
      actorType: "mcp",
    });
  });

  it("enforces submissions:read for both submission tools", async () => {
    const t = setup({
      tokens: new FakeTokens({ [TOKEN_A]: tokenFor(TOKEN_ID_A, WORKSPACE_A, ["docs:read", "docs:write", "docs:publish"]) }),
    });
    const list = await t.call("list_submissions", { documentId: "doc_a1" });
    const summary = await t.call("summarize_responses", { documentId: "doc_a1" });
    expect(payload(list).error.code).toBe("FORBIDDEN");
    expect(payload(summary).error.code).toBe("FORBIDDEN");
    expect(t.audit.byAction("list_submissions")[0]?.errorCode).toBe("FORBIDDEN");
    expect(t.audit.byAction("summarize_responses")[0]?.errorCode).toBe("FORBIDDEN");
  });

  it("fails auth for an invalid token and audits with no workspace attribution", async () => {
    const t = setup();
    const result = await t.call("get_document", { documentId: "doc_a1" }, "not-a-token");
    expect(result.isError).toBe(true);
    expect(payload(result).error.code).toBe("FORBIDDEN");
    expect(t.audit.entries[0]).toMatchObject({
      action: "get_document",
      status: "error",
      errorCode: "FORBIDDEN",
      workspaceId: null,
      actorId: null,
    });
  });

  it("throws a protocol error for unknown tools but still audits the attempt", async () => {
    const t = setup();
    await expect(t.call("delete_all_documents", {})).rejects.toThrow(/Unknown tool/);
    expect(t.audit.entries[0]).toMatchObject({
      action: "delete_all_documents",
      status: "error",
      errorCode: "NOT_FOUND",
      workspaceId: WORKSPACE_A,
    });
  });

  it("writes exactly one audit entry per tool call — success or failure", async () => {
    const t = setup({ documents: new FakeDocuments([seedDoc({ id: "doc_a1" })]) });
    await t.call("list_documents", {});
    await t.call("get_document", { documentId: "doc_a1" });
    await t.call("get_document", { documentId: "doc_b1" }); // FORBIDDEN
    await t.call("get_document", { documentId: 42 }); // VALIDATION
    expect(t.audit.entries).toHaveLength(4);
    for (const entry of t.audit.entries) {
      expect(entry.actorType).toBe("mcp");
      expect(entry.actorId).toBe(TOKEN_ID_A);
      expect(entry.workspaceId).toBe(WORKSPACE_A);
    }
    expect(t.audit.entries.map((entry) => entry.status)).toEqual(["ok", "ok", "error", "error"]);
  });

  it("scopes tokens to their own workspace end-to-end (workspace B token cannot see A)", async () => {
    const t = setup({ documents: new FakeDocuments(seedWorkspaceA()) });
    const result = await t.call("list_documents", {}, TOKEN_B);
    expect(result.isError).toBeFalsy();
    expect(payload(result).data).toEqual([]);
    expect(t.audit.entries[0]).toMatchObject({ workspaceId: WORKSPACE_B, actorId: TOKEN_ID_B });
  });

  it("accepts tokens carrying every scope", () => {
    expect(ALL_SCOPES).toEqual(["docs:read", "docs:write", "docs:publish", "submissions:read"]);
  });
});
