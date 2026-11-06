// packages/mcp/src/pipeline.ts — the single execution path every tool call
// takes. Responsibilities, in order:
//   1. resolve the API token (T25 seam) → workspace + scopes
//   2. tool lookup
//   3. scope check (FORBIDDEN on missing scopes)
//   4. strict argument validation (VALIDATION)
//   5. handler invocation with a spec §3 `Ctx` (actor type 'mcp')
//   6. exactly one audit_log append per call — success OR failure (issue #26)
// Errors are reported as MCP tool results with `isError: true` and the spec §4
// error body `{ error: { code, message, details } }`; only protocol-level
// failures (unknown tool) surface as JSON-RPC errors.
import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { newAuditEntry } from "./audit.ts";
import type { AuditLog } from "./audit.ts";
import { AppError } from "./bridge.ts";
import type { Ctx } from "./bridge.ts";
import { zodIssuesToDetails } from "./bridge.ts";
import type { FormForgeMcpDeps, TokenRecord } from "./services.ts";
import type { AnyTool } from "./tools.ts";

export function defaultNow(): Date {
  return new Date();
}

export function buildCtx(token: TokenRecord, requestId: string, deps: FormForgeMcpDeps): Ctx {
  return {
    workspaceId: token.workspaceId,
    actor: { type: "mcp", id: token.tokenId },
    requestId,
    now: deps.now ?? defaultNow,
  };
}

export function toolSuccess(value: unknown): CallToolResult {
  return {
    content: [textContent(JSON.stringify(value, null, 2))],
  };
}

export function toolError(error: AppError): CallToolResult {
  return {
    isError: true,
    content: [
      textContent(
        JSON.stringify(
          { error: { code: error.code, message: error.message, details: error.details } },
          null,
          2,
        ),
      ),
    ],
  };
}

function textContent(text: string): TextContent {
  return { type: "text", text };
}

async function audit(
  auditLog: AuditLog,
  deps: FormForgeMcpDeps,
  entry: Omit<Parameters<AuditLog["append"]>[0], "id" | "createdAt" | "actorType"> & { actorId: string | null },
): Promise<void> {
  await auditLog.append(
    newAuditEntry({
      ...entry,
      actorType: "mcp",
      createdAt: (deps.now ?? defaultNow)(),
    }),
  );
}

export async function executeToolCall(
  deps: FormForgeMcpDeps,
  tools: ReadonlyMap<string, AnyTool>,
  toolName: string,
  rawArgs: unknown,
  requestId: string,
): Promise<CallToolResult> {
  // 1. Auth: token → workspace + scopes (issue: "workspace from token").
  const resolved = await deps.tokens.resolve(deps.rawToken);
  if (!resolved.ok) {
    await audit(deps.audit, deps, {
      workspaceId: null, // not attributable — see AuditEntry SPEC-NOTE
      actorId: null,
      action: toolName,
      target: null,
      status: "error",
      errorCode: resolved.error.code,
    });
    return toolError(resolved.error);
  }
  const token = resolved.value;

  // 2. Tool lookup — unknown tool is a protocol error, still audited.
  const tool = tools.get(toolName);
  if (tool === undefined) {
    await audit(deps.audit, deps, {
      workspaceId: token.workspaceId,
      actorId: token.tokenId,
      action: toolName,
      target: null,
      status: "error",
      errorCode: "NOT_FOUND",
    });
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
  }

  // 3. Scope check.
  const missingScopes = tool.spec.requiredScopes.filter((scope) => !token.scopes.includes(scope));
  if (missingScopes.length > 0) {
    const error = new AppError(
      "FORBIDDEN",
      `API token is missing required scope(s): ${missingScopes.join(", ")}`,
    );
    await auditFailure(deps, tool, token, rawArgs, error);
    return toolError(error);
  }

  // 4. Argument validation.
  const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const error = new AppError("VALIDATION", "Invalid tool arguments", zodIssuesToDetails(parsed.error));
    await auditFailure(deps, tool, token, rawArgs, error);
    return toolError(error);
  }

  // 5. Handler with a fully-scoped Ctx (actor type 'mcp').
  const ctx = buildCtx(token, requestId, deps);
  let result;
  try {
    result = await tool.handler(ctx, parsed.data);
  } catch (cause) {
    // Programmer error — services must not throw across module boundaries
    // (spec §3); fail closed instead of crashing the server.
    result = {
      ok: false as const,
      error: new AppError("INTERNAL", `Tool handler threw: ${String(cause)}`),
    };
  }

  // 6. Audit exactly once per call, then shape the MCP result.
  const rawTarget = tool.spec.targetOf(rawArgs);
  const target =
    result.ok && tool.spec.resultTarget !== undefined
      ? (tool.spec.resultTarget(result.value) ?? rawTarget)
      : rawTarget;
  if (result.ok) {
    await audit(deps.audit, deps, {
      workspaceId: token.workspaceId,
      actorId: token.tokenId,
      action: tool.spec.name,
      target,
      status: "ok",
    });
    return toolSuccess(result.value);
  }
  await auditFailure(deps, tool, token, rawArgs, result.error, target);
  return toolError(result.error);
}

async function auditFailure(
  deps: FormForgeMcpDeps,
  tool: AnyTool,
  token: TokenRecord,
  rawArgs: unknown,
  error: AppError,
  targetOverride?: string | null,
): Promise<void> {
  await audit(deps.audit, deps, {
    workspaceId: token.workspaceId,
    actorId: token.tokenId,
    action: tool.spec.name,
    target: targetOverride !== undefined ? targetOverride : tool.spec.targetOf(rawArgs),
    status: "error",
    errorCode: error.code,
  });
}
