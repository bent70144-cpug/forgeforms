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

// INTEGRATION-DEBT re-exports (see src/bridge.ts): swap to
// @formforge/core (Ctx, Result, AppError, Scope) and @formforge/schema
// (DocumentBody, Block, Theme, Settings, Rule, Ending, Op) when they land.
export {
  AppError,
  Block,
  DocumentBody,
  Ending,
  Op,
  Rule,
  Settings,
  TOKEN_SCOPES,
  Theme,
  err,
  ok,
  validateDocumentBody,
  zodIssuesToDetails,
} from "./bridge.ts";
export type {
  ActorType,
  AppErrorCode,
  AppErrorDetail,
  Ctx,
  Result,
  Scope,
} from "./bridge.ts";
