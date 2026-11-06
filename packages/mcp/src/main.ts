#!/usr/bin/env node
// packages/mcp/src/main.ts — stdio entrypoint (`bin` formforge-mcp).
//
// Usage:
//   FORMFORGE_API_TOKEN=<token> formforge-mcp
//   formforge-mcp --token <token>
//
// The workspace is derived from the API token (spec §11); the token's scopes
// gate every tool call. Audit log lines go to stderr (stdout carries the MCP
// JSON-RPC stream).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConsoleAuditLog } from "./audit.ts";
import { API_TOKEN_ENV_VAR, readApiToken } from "./config.ts";
import { createMcpServer } from "./server.ts";
import { unwiredDocuments, unwiredSubmissions, unwiredTokenResolver } from "./unwired.ts";
import type { FormForgeMcpDeps } from "./services.ts";

export async function main(argv: string[] = process.argv.slice(2), env = process.env): Promise<void> {
  const rawToken = readApiToken(argv, env);
  if (rawToken === null) {
    console.error(`formforge-mcp: missing API token — pass --token <token> or set ${API_TOKEN_ENV_VAR}`);
    process.exitCode = 1;
    return;
  }

  const deps: FormForgeMcpDeps = {
    rawToken,
    tokens: unwiredTokenResolver,
    documents: unwiredDocuments,
    submissions: unwiredSubmissions,
    audit: new ConsoleAuditLog(),
  };

  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
  // StdioServerTransport keeps the event loop alive while the client is attached.
}

main().catch((error) => {
  console.error("formforge-mcp: fatal:", error);
  process.exitCode = 1;
});
