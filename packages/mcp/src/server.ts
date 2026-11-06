// packages/mcp/src/server.ts — MCP server assembly (transport-agnostic).
// The transport (stdio for production, InMemoryTransport for tests/E2E) is
// attached by the caller via `server.connect(...)`.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { executeToolCall } from "./pipeline.ts";
import type { FormForgeMcpDeps } from "./services.ts";
import { buildToolDefinitions, toolMap } from "./tools.ts";
import type { AnyTool } from "./tools.ts";

export const SERVER_NAME = "formforge-mcp";
export const SERVER_VERSION = "0.1.0";

/** Low-level SDK server — CallTool is handled by our pipeline so that every
 * call (including invalid-argument and authorization failures) is audited and
 * answered with a structured tool result rather than bypassing audit. */
export function createMcpServer(deps: FormForgeMcpDeps): Server {
  const tools = toolMap(buildToolDefinitions(deps));

  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map(toProtocolTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const requestId =
      extra.requestId !== undefined ? `mcp:${String(extra.requestId)}` : randomUUID();
    return executeToolCall(deps, tools, request.params.name, request.params.arguments ?? {}, requestId);
  });

  return server;
}

function toProtocolTool(tool: AnyTool): Tool {
  // io: "input" keeps defaulted fields optional for callers; recursive
  // DocumentBody blocks are emitted as $defs/$ref.
  const inputSchema = z.toJSONSchema(tool.inputSchema, {
    io: "input",
    unrepresentable: "any",
  }) as Tool["inputSchema"];
  return {
    name: tool.spec.name,
    title: tool.spec.title,
    description: tool.spec.description,
    inputSchema,
    annotations: tool.spec.annotations,
  };
}
