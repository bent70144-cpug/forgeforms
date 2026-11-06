// test/e2e.test.ts — issue #26 acceptance: a sample MCP client lists, creates,
// applies ops, publishes and reads submissions end-to-end over a real MCP
// transport (InMemoryTransport), and every call lands in the audit log with
// actor_type='mcp'.
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.ts";
import { TOOL_NAMES } from "../src/tools.ts";
import {
  FakeSubmissions,
  WORKSPACE_A,
  WORKSPACE_B,
  makeDeps,
  makeDocumentBody,
  seedDoc,
} from "./fakes.ts";
import type { FakeSubmissionRow } from "./fakes.ts";

function textOf(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] }).content?.[0];
  expect(content?.type).toBe("text");
  return content?.text ?? "";
}

describe("sample MCP client end-to-end", () => {
  it("lists, creates, applies ops, publishes and reads submissions", async () => {
    // Submissions fake is injected up front: tool definitions bind their service
    // at server construction, so documents created mid-run are registered on it
    // afterwards (see registerDocument below).
    const submissions = new FakeSubmissions();
    const { deps, audit, documents } = makeDeps({ submissions });
    documents.rows.push(seedDoc({ id: "doc_seed", title: "Seeded form" }));
    documents.rows.push(seedDoc({ id: "doc_foreign", workspaceId: WORKSPACE_B }));

    const server = createMcpServer(deps);
    const client = new Client({ name: "sample-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      // 1. list tools — exactly the 7 from the issue.
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());

      // 2. list documents.
      const listedDocs = JSON.parse(
        textOf(await client.callTool({ name: "list_documents", arguments: {} })),
      ) as { data: { id: string }[] };
      expect(listedDocs.data.map((doc) => doc.id)).toEqual(["doc_seed"]);

      // 3. create a document with a full DocumentBody draft.
      const body = makeDocumentBody({
        type: "form",
        blocks: [{ id: "q1", kind: "email", props: { label: "Email", required: true } }],
      });
      const created = JSON.parse(
        textOf(
          await client.callTool({
            name: "create_document",
            arguments: { type: "form", title: "Onboarding survey", body },
          }),
        ),
      ) as { id: string; rev: number; status: string; slug: string };
      expect(created.status).toBe("draft");
      expect(created.rev).toBe(0);

      // 4. apply ops (rename + insert a block) with optimistic concurrency.
      const updated = JSON.parse(
        textOf(
          await client.callTool({
            name: "apply_ops",
            arguments: {
              documentId: created.id,
              baseRev: 0,
              ops: [
                { op: "meta.update", patch: { title: "Onboarding survey v2" } },
                {
                  op: "block.insert",
                  index: 0,
                  block: { id: "hero1", kind: "hero", props: { title: "Welcome" } },
                },
              ],
            },
          }),
        ),
      ) as { id: string; rev: number; title: string; draft: { blocks: { id: string }[] } };
      expect(updated.rev).toBe(1);
      expect(updated.title).toBe("Onboarding survey v2");
      expect(updated.draft.blocks.map((block) => block.id)).toEqual(["hero1", "q1"]);

      // 5. publish.
      const published = JSON.parse(
        textOf(await client.callTool({ name: "publish_document", arguments: { documentId: created.id } })),
      ) as { id: string; status: string; publishedVersionId: string };
      expect(published.status).toBe("published");
      expect(published.publishedVersionId).toBeTruthy();

      // 6. read submissions for the published document.
      const submission: FakeSubmissionRow = {
        id: "sub_1",
        documentId: created.id,
        workspaceId: WORKSPACE_A,
        versionId: published.publishedVersionId,
        status: "completed",
        completedAt: "2026-11-05T10:00:00.000Z",
        answers: { q_email: { label: "Email", value: "ada@example.com" } },
        variables: { score: 7 },
        hidden: { utm_source: "newsletter" },
      };
      submissions.registerDocument(created.id, WORKSPACE_A);
      submissions.rows.push(submission);
      const submissionsPage = JSON.parse(
        textOf(
          await client.callTool({
            name: "list_submissions",
            arguments: { documentId: created.id },
          }),
        ),
      ) as { data: { id: string; answers: Record<string, { label: string; value: unknown }> }[] };
      expect(submissionsPage.data).toHaveLength(1);
      expect(submissionsPage.data[0]?.answers.q_email).toEqual({
        label: "Email",
        value: "ada@example.com",
      });

      // 7. summarize responses.
      const summary = JSON.parse(
        textOf(
          await client.callTool({
            name: "summarize_responses",
            arguments: { documentId: created.id },
          }),
        ),
      ) as { total: number; completed: number; perQuestion: { blockId: string }[] };
      expect(summary.total).toBe(1);
      expect(summary.completed).toBe(1);
      expect(summary.perQuestion.map((question) => question.blockId)).toContain("q_email");

      // 8. cross-workspace isolation through the wire (issue acceptance).
      const foreign = await client.callTool({
        name: "get_document",
        arguments: { documentId: "doc_foreign" },
      });
      expect(foreign.isError).toBe(true);
      expect(JSON.parse(textOf(foreign)).error.code).toBe("FORBIDDEN");

      // 9. every call audited with actor_type='mcp' and the correct target.
      // 7 tool calls happened (listTools is a protocol call, not a tool call,
      // and is deliberately not audited).
      expect(audit.entries).toHaveLength(7);
      for (const entry of audit.entries) {
        expect(entry.actorType).toBe("mcp");
        expect(entry.actorId).toBeTruthy();
      }
      expect(audit.byAction("create_document")[0]?.target).toBe(created.id);
      expect(audit.byAction("apply_ops")[0]?.target).toBe(created.id);
      expect(audit.byAction("publish_document")[0]?.target).toBe(created.id);
      expect(audit.byAction("list_documents")[0]?.status).toBe("ok");
      expect(audit.byAction("get_document")[0]?.status).toBe("error");
      expect(audit.byAction("get_document")[0]?.target).toBe("doc_foreign");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("answers invalid arguments with a structured VALIDATION tool result", async () => {
    const { deps, audit } = makeDeps();
    const server = createMcpServer(deps);
    const client = new Client({ name: "sample-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const bad = await client.callTool({
        name: "create_document",
        arguments: {
          type: "form",
          title: "Bad draft",
          body: { schemaVersion: 2, type: "form", theme: { tokens: {} }, blocks: [] },
        },
      });
      expect(bad.isError).toBe(true);
      const error = JSON.parse(textOf(bad)) as { error: { code: string } };
      expect(error.error.code).toBe("VALIDATION");
      expect(audit.entries[0]).toMatchObject({ action: "create_document", status: "error" });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("surfaces unknown tools as a JSON-RPC protocol error", async () => {
    const { deps, audit } = makeDeps();
    const server = createMcpServer(deps);
    const client = new Client({ name: "sample-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await expect(
        client.callTool({ name: "delete_workspace", arguments: {} }),
      ).rejects.toThrow(/Unknown tool/);
      expect(audit.entries[0]).toMatchObject({ action: "delete_workspace", status: "error" });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
