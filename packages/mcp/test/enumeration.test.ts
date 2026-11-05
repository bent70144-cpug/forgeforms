import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.ts";
import { buildToolDefinitions, TOOL_NAMES } from "../src/tools.ts";
import { makeDeps } from "./fakes.ts";

// Issue #26 acceptance: "No delete capability exists on the server surface".
describe("server surface enumeration", () => {
  it("exposes exactly the 7 specified tools", () => {
    const { deps } = makeDeps();
    const names = buildToolDefinitions(deps).map((tool) => tool.spec.name);
    expect([...names].sort()).toEqual([...TOOL_NAMES].sort());
    expect(names).toHaveLength(7);
  });

  it("has no tool name suggesting deletion or destruction", () => {
    const { deps } = makeDeps();
    const banned = /delete|destroy|remove|archive|purge|trash|unpublish|drop/i;
    for (const tool of buildToolDefinitions(deps)) {
      expect(tool.spec.name).not.toMatch(banned);
    }
  });

  it("marks no tool as destructive", () => {
    const { deps } = makeDeps();
    for (const tool of buildToolDefinitions(deps)) {
      expect(tool.spec.annotations.destructiveHint).not.toBe(true);
    }
  });

  it("advertises the same surface over the MCP protocol (listTools)", async () => {
    const { deps, audit } = makeDeps();
    const server = createMcpServer(deps);
    const client = new Client({ name: "enumeration-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe("object");
      }
      expect(audit.entries).toHaveLength(0); // listing tools is not a tool call
    } finally {
      await client.close();
      await server.close();
    }
  });
});
