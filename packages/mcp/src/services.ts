// packages/mcp/src/services.ts — the seam between the MCP layer and the
// FormForge domain services (spec §3 module contract: service functions take a
// `Ctx` first argument and return `Result<T, AppError>`).
//
// INTEGRATION-DEBT: awaiting T02 (documents/submissions modules) and T25 (API
// tokens). These interfaces describe exactly what the MCP server needs; the
// real implementations will be injected in the process composition root
// (src/main.ts). Fakes live in test/fakes.ts.
import type { Ctx, Result } from "@formforge/core";
import type { ApiScope as Scope } from "@formforge/core/api";
import type { DocumentBody } from "@formforge/schema";
import type { DocumentOp as Op } from "@formforge/schema";
import type { AuditLog } from "./audit.ts";

export type DocumentType = "form" | "page" | "portfolio";
export type DocumentStatus = "draft" | "published" | "archived";

export type Page<T> = { data: T[]; nextCursor: string | null };

// --- tokens (T25 contract: spec §6 `api_tokens`) -----------------------------

export type TokenRecord = {
  tokenId: string;
  workspaceId: string;
  scopes: Scope[];
};

export interface TokenResolver {
  /** Raw plaintext API token → token record (workspace + scopes). */
  resolve(rawToken: string): Promise<Result<TokenRecord>>;
}

// --- documents ---------------------------------------------------------------

export type DocumentSummary = {
  id: string;
  type: DocumentType;
  title: string;
  slug: string;
  status: DocumentStatus;
  rev: number;
  updatedAt: string;
};

export type DocumentDetail = DocumentSummary & {
  draft: DocumentBody;
  publishedVersionId: string | null;
  createdAt: string;
};

export type ListDocumentsQuery = {
  type?: DocumentType;
  status?: DocumentStatus;
  q?: string;
  limit?: number;
  cursor?: string;
};

export type CreateDocumentInput = {
  type: DocumentType;
  title: string;
  slug?: string;
  body?: DocumentBody;
};

export type ApplyOpsInput = {
  baseRev: number;
  ops: Op[];
};

export type PublishResult = {
  id: string;
  status: "published";
  publishedVersionId: string;
  rev: number;
};

export interface DocumentService {
  listDocuments(ctx: Ctx, query: ListDocumentsQuery): Promise<Result<Page<DocumentSummary>>>;
  getDocument(ctx: Ctx, documentId: string): Promise<Result<DocumentDetail>>;
  createDocument(ctx: Ctx, input: CreateDocumentInput): Promise<Result<DocumentDetail>>;
  applyOps(ctx: Ctx, documentId: string, input: ApplyOpsInput): Promise<Result<DocumentDetail>>;
  publishDocument(ctx: Ctx, documentId: string): Promise<Result<PublishResult>>;
}

// --- submissions -------------------------------------------------------------

export type SubmissionRow = {
  id: string;
  documentId: string;
  versionId: string;
  status: "draft" | "completed" | "spam";
  completedAt: string | null;
  /** blockId → answer, labelled per spec §12 webhook payload shape. */
  answers: Record<string, { label: string; value: unknown }>;
  variables: Record<string, unknown>;
  hidden: Record<string, unknown>;
};

export type ListSubmissionsQuery = {
  limit?: number;
  cursor?: string;
};

export type QuestionAggregate = {
  blockId: string;
  label: string;
  kind: string;
  answered: number;
  distribution?: Record<string, number>;
  average?: number;
};

export type NpsSummary = {
  promoters: number;
  passives: number;
  detractors: number;
  score: number;
  responses: number;
};

export type ResponseSummary = {
  documentId: string;
  total: number;
  completed: number;
  perQuestion: QuestionAggregate[];
  nps: NpsSummary | null;
};

export interface SubmissionService {
  listSubmissions(
    ctx: Ctx,
    documentId: string,
    query: ListSubmissionsQuery,
  ): Promise<Result<Page<SubmissionRow>>>;
  summarizeResponses(ctx: Ctx, documentId: string): Promise<Result<ResponseSummary>>;
}

// --- process-level dependencies ---------------------------------------------

export type FormForgeMcpDeps = {
  /** Raw plaintext FormForge API token (env `FORMFORGE_API_TOKEN` or `--token`). */
  rawToken: string;
  tokens: TokenResolver;
  documents: DocumentService;
  submissions: SubmissionService;
  audit: AuditLog;
  /** Injectable clock (spec §4: never `new Date()` in services). */
  now?: () => Date;
};
