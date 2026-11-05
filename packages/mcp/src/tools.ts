// packages/mcp/src/tools.ts — the 7 MCP tools (issue #26, spec §15 M8).
//
// Surface contract:
//   list_documents, get_document, create_document, apply_ops,
//   publish_document, list_submissions, summarize_responses
// There is deliberately NO delete/destroy tool of any kind — the only mutation
// surface is create / apply_ops / publish. `block.remove` etc. inside
// `apply_ops` edit a draft's blocks (spec §8 authoring ops); they never delete
// documents, versions or submissions.
//
// Every handler is pure with respect to this package: it receives a built
// `Ctx` and validated args, calls the injected services, and returns a
// `Result`. Scoping, argument validation, ctx construction and audit logging
// live in the pipeline (src/pipeline.ts), not here.
import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { AppError, DocumentBody, Op, err } from "./bridge.ts";
import type { Ctx, Result, Scope } from "./bridge.ts";
import type {
  CreateDocumentInput,
  DocumentService,
  DocumentStatus,
  DocumentType,
  ListSubmissionsQuery,
  SubmissionService,
} from "./services.ts";
import { validateDocumentBody } from "./bridge.ts";

export const TOOL_NAMES = [
  "list_documents",
  "get_document",
  "create_document",
  "apply_ops",
  "publish_document",
  "list_submissions",
  "summarize_responses",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolSpec = {
  name: ToolName;
  title: string;
  description: string;
  requiredScopes: readonly Scope[];
  annotations: ToolAnnotations;
  /** Audit target derived from raw (possibly unvalidated) args. */
  targetOf: (rawArgs: unknown) => string | null;
  /** Optional audit target derived from a successful result (e.g. new doc id). */
  resultTarget?: (value: unknown) => string | null;
};

export type ToolDefinition<A> = {
  spec: ToolSpec;
  inputSchema: z.ZodType<A>;
  handler: (ctx: Ctx, args: A) => Promise<Result<unknown>> | Result<unknown>;
};

/** Heterogeneous registry entry (`ToolDefinition<never>`). The pipeline is the
 * only caller of handlers and it always passes args validated by the paired
 * `inputSchema`, so the handler arg type is erased at the registry boundary. */
export type AnyTool = ToolDefinition<never>;

/** Erases a concrete tool's arg type for the heterogeneous registry. */
export function asTool<A>(definition: ToolDefinition<A>): AnyTool {
  return definition as unknown as AnyTool;
}

const DOCUMENT_TYPES = ["form", "page", "portfolio"] as const satisfies readonly DocumentType[];
const DOCUMENT_STATUSES = ["draft", "published", "archived"] as const satisfies readonly DocumentStatus[];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const documentIdSchema = z.string().min(1).describe("Document id (`doc_…` short id or UUID)");

function documentIdTarget(rawArgs: unknown): string | null {
  if (typeof rawArgs === "object" && rawArgs !== null && "documentId" in rawArgs) {
    const value = (rawArgs as { documentId?: unknown }).documentId;
    if (typeof value === "string") return value;
  }
  return null;
}

const readOnly: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const mutating: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

// ---------------------------------------------------------------------------
// Document tools (docs:read / docs:write / docs:publish)
// ---------------------------------------------------------------------------

export function makeListDocuments(documents: DocumentService): AnyTool {
  const inputSchema = z.object({
    type: z.enum(DOCUMENT_TYPES).optional().describe("Filter by document type"),
    status: z.enum(DOCUMENT_STATUSES).optional().describe("Filter by lifecycle status"),
    q: z.string().min(1).optional().describe("Full-text query over titles"),
    limit: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
    cursor: z.string().min(1).optional().describe("Opaque pagination cursor (nextCursor)"),
  });
  return asTool({
    spec: {
      name: "list_documents",
      title: "List documents",
      description:
        "List documents (forms, pages, portfolios) in the workspace of the API token. Supports type/status filters, a title search, and cursor pagination.",
      requiredScopes: ["docs:read"],
      annotations: readOnly,
      targetOf: () => null,
    },
    inputSchema,
    handler: (ctx, args) => documents.listDocuments(ctx, args),
  });
}

export function makeGetDocument(documents: DocumentService): AnyTool {
  const inputSchema = z.object({ documentId: documentIdSchema });
  return asTool({
    spec: {
      name: "get_document",
      title: "Get document",
      description:
        "Fetch one document with metadata and its current draft DocumentBody (spec §7). Documents outside the token's workspace are rejected with FORBIDDEN.",
      requiredScopes: ["docs:read"],
      annotations: readOnly,
      targetOf: documentIdTarget,
    },
    inputSchema,
    handler: (ctx, args) => documents.getDocument(ctx, args.documentId),
  });
}

export function makeCreateDocument(documents: DocumentService): AnyTool {
  const inputSchema = z.object({
    type: z.enum(DOCUMENT_TYPES).describe("Document type to create"),
    title: z.string().min(1).max(300).describe("Human title"),
    slug: z
      .string()
      .regex(SLUG_PATTERN)
      .optional()
      .describe("URL slug, unique per workspace (defaults to slugified title)"),
    // SPEC-NOTE: extends spec §11 `POST /documents {type, title, templateId?}`
    // with an optional full DocumentBody so MCP/AI clients (spec §15 M8) can
    // create a fully-drafted document in one call. It is validated against the
    // strict DocumentBody schema right here at the MCP boundary — an
    // unvalidated body never reaches the service.
    body: DocumentBody.optional().describe(
      "Full DocumentBody draft (spec §7). Omit to start from an empty draft.",
    ),
  });
  return asTool({
    spec: {
      name: "create_document",
      title: "Create document",
      description:
        "Create a new draft document (form, page or portfolio) in the workspace of the API token, optionally seeded with a full DocumentBody draft.",
      requiredScopes: ["docs:write"],
      annotations: mutating,
      targetOf: () => null,
      resultTarget: (value) => {
        const id = (value as { id?: unknown }).id;
        return typeof id === "string" ? id : null;
      },
    },
    inputSchema,
    handler: (ctx, args) => {
      const input: CreateDocumentInput = {
        type: args.type,
        title: args.title,
        slug: args.slug,
        body: args.body,
      };
      return documents.createDocument(ctx, input);
    },
  });
}

export function makeApplyOps(documents: DocumentService): AnyTool {
  const inputSchema = z.object({
    documentId: documentIdSchema,
    baseRev: z
      .number()
      .int()
      .min(0)
      .describe("Revision the caller based the edit on; a stale value yields CONFLICT"),
    ops: z
      .array(Op)
      .min(1)
      .max(100)
      .describe(
        "Authoring ops applied in order to the draft (spec §8): block insert/update/move, settings/theme/meta updates, ending and rule upserts.",
      ),
  });
  return asTool({
    spec: {
      name: "apply_ops",
      title: "Apply authoring ops",
      description:
        "Apply authoring ops to a document draft with optimistic concurrency (`baseRev`). The server applies ops in order, validates the resulting DocumentBody and increments the revision.",
      requiredScopes: ["docs:write"],
      annotations: mutating,
      targetOf: documentIdTarget,
    },
    inputSchema,
    handler: async (ctx, args) => {
      const result = await documents.applyOps(ctx, args.documentId, {
        baseRev: args.baseRev,
        ops: args.ops,
      });
      if (!result.ok) return result;
      // SPEC-NOTE: for updates the pre-service validation is the strict
      // `ops` schema above; the post-condition check below additionally
      // guarantees the MCP surface never accepts/persists an invalid body.
      const draft = validateDocumentBody(result.value.draft);
      if (!draft.ok) {
        return err(
          new AppError(
            "INTERNAL",
            "Document service returned an invalid DocumentBody after applying ops",
            draft.error.details,
          ),
        );
      }
      return result;
    },
  });
}

export function makePublishDocument(documents: DocumentService): AnyTool {
  const inputSchema = z.object({ documentId: documentIdSchema });
  return asTool({
    spec: {
      name: "publish_document",
      title: "Publish document",
      description:
        "Publish a document: validates the draft, snapshots it into an immutable version and makes it publicly available. Idempotent per revision; never deletes anything.",
      requiredScopes: ["docs:publish"],
      annotations: mutating,
      targetOf: documentIdTarget,
    },
    inputSchema,
    handler: (ctx, args) => documents.publishDocument(ctx, args.documentId),
  });
}

// ---------------------------------------------------------------------------
// Submission tools (submissions:read)
// ---------------------------------------------------------------------------

export function makeListSubmissions(submissions: SubmissionService): AnyTool {
  const inputSchema = z.object({
    documentId: documentIdSchema,
    limit: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
    cursor: z.string().min(1).optional().describe("Opaque pagination cursor (nextCursor)"),
  });
  return asTool({
    spec: {
      name: "list_submissions",
      title: "List submissions",
      description:
        "List submissions for a document (table data): labelled answers, logic variables and hidden fields, cursor-paginated, newest first.",
      requiredScopes: ["submissions:read"],
      annotations: readOnly,
      targetOf: documentIdTarget,
    },
    inputSchema,
    handler: (ctx, args): Promise<Result<unknown>> => {
      const query: ListSubmissionsQuery = { limit: args.limit, cursor: args.cursor };
      return submissions.listSubmissions(ctx, args.documentId, query);
    },
  });
}

export function makeSummarizeResponses(submissions: SubmissionService): AnyTool {
  const inputSchema = z.object({ documentId: documentIdSchema });
  return asTool({
    spec: {
      name: "summarize_responses",
      title: "Summarize responses",
      description:
        "Aggregate responses for a document: per-question counts/distributions/averages plus NPS (promoters/passives/detractors/score).",
      requiredScopes: ["submissions:read"],
      annotations: readOnly,
      targetOf: documentIdTarget,
    },
    inputSchema,
    handler: (ctx, args) => submissions.summarizeResponses(ctx, args.documentId),
  });
}

// ---------------------------------------------------------------------------

export function buildToolDefinitions(deps: {
  documents: DocumentService;
  submissions: SubmissionService;
}): AnyTool[] {
  const tools: AnyTool[] = [
    makeListDocuments(deps.documents),
    makeGetDocument(deps.documents),
    makeCreateDocument(deps.documents),
    makeApplyOps(deps.documents),
    makePublishDocument(deps.documents),
    makeListSubmissions(deps.submissions),
    makeSummarizeResponses(deps.submissions),
  ];
  const names = new Set(tools.map((tool) => tool.spec.name));
  if (names.size !== TOOL_NAMES.length) {
    throw new Error("duplicate tool names in MCP registry");
  }
  return tools;
}

export function toolMap(tools: readonly AnyTool[]): Map<string, AnyTool> {
  return new Map(tools.map((tool) => [tool.spec.name as string, tool]));
}
