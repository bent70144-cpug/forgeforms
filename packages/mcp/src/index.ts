// packages/mcp/src/index.ts — public surface of @formforge/mcp.
export { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.ts";
export { executeToolCall, buildCtx, toolSuccess, toolError } from "./pipeline.ts";
export { TOOL_NAMES, buildToolDefinitions, toolMap } from "./tools.ts";
export type { AnyTool, ToolDefinition, ToolSpec, ToolName } from "./tools.ts";
export { ConsoleAuditLog, InMemoryAuditLog, newAuditEntry } from "./audit.ts";
export type { AuditEntry, AuditLog } from "./audit.ts";
export { readApiToken, API_TOKEN_ENV_VAR } from "./config.ts";
export { unwiredTokenResolver, unwiredDocuments, unwiredSubmissions } from "./unwired.ts";
export type {
  FormForgeMcpDeps,
  TokenRecord,
  TokenResolver,
  DocumentService,
  SubmissionService,
  DocumentSummary,
  DocumentDetail,
  SubmissionRow,
  ResponseSummary,
  QuestionAggregate,
  NpsSummary,
  Page,
  PublishResult,
} from "./services.ts";

// ISSUE #30: the bridge re-exports were retired — kernel types come from
// @formforge/core (+ @formforge/core/api for scopes), document types from
// @formforge/schema, and validation lives in ./validation.ts.
