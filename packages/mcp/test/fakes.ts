// test/fakes.ts — in-memory implementations of the service seams (spec-faithful
// behaviour: tenant scoping via ctx.workspaceId, Result returns, no throws).
import { randomUUID } from "node:crypto";
import { AppError, err, ok } from "@formforge/core";
import {
  DocumentBody as DocumentBodySchema,
  type DocumentBody,
  type DocumentSettings,
  type Theme,
} from "@formforge/schema";
import type { Ctx, Result } from "@formforge/core";
import type { ApiScope as Scope } from "@formforge/core/api";
import type { DocumentOp as Op } from "@formforge/schema";
import type {
  ApplyOpsInput,
  CreateDocumentInput,
  DocumentDetail,
  DocumentService,
  DocumentStatus,
  DocumentSummary,
  DocumentType,
  FormForgeMcpDeps,
  ListDocumentsQuery,
  ListSubmissionsQuery,
  NpsSummary,
  Page,
  QuestionAggregate,
  PublishResult,
  ResponseSummary,
  SubmissionRow,
  SubmissionService,
  TokenRecord,
  TokenResolver,
} from "../src/services.ts";
import { InMemoryAuditLog } from "../src/audit.ts";

export const WORKSPACE_A = "018f0000-0000-7000-8000-00000000000a";
export const WORKSPACE_B = "018f0000-0000-7000-8000-00000000000b";
export const TOKEN_ID_A = "018f0000-0000-7000-8000-00000000tok1";
export const TOKEN_ID_B = "018f0000-0000-7000-8000-00000000tok2";

export const ALL_SCOPES = ["docs:read", "docs:write", "docs:publish", "submissions:read"] as const satisfies readonly Scope[];

export const fixedNow = (): Date => new Date("2026-11-06T12:00:00.000Z");

// --- tokens -----------------------------------------------------------------

export class FakeTokens implements TokenResolver {
  private readonly records: Record<string, TokenRecord>;

  constructor(records: Record<string, TokenRecord>) {
    this.records = records;
  }

  async resolve(rawToken: string): Promise<Result<TokenRecord>> {
    const record = this.records[rawToken];
    if (record === undefined) {
      return err(new AppError("FORBIDDEN", "Invalid API token"));
    }
    return ok({ ...record, scopes: [...record.scopes] });
  }
}

// --- documents --------------------------------------------------------------

export type FakeDocRow = {
  id: string;
  workspaceId: string;
  type: DocumentType;
  title: string;
  slug: string;
  status: DocumentStatus;
  rev: number;
  draft: DocumentBody;
  publishedVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function makeDocumentBody(overrides: Record<string, unknown> = {}): DocumentBody {
  return DocumentBodySchema.parse({
    schemaVersion: 1,
    type: "form",
    theme: { tokens: {} },
    settings: {}, // inner fields default per spec §7
    blocks: [],
    ...overrides,
  });
}

export function seedDoc(overrides: Partial<FakeDocRow> = {}): FakeDocRow {
  return {
    id: `doc_${randomUUID()}`,
    workspaceId: WORKSPACE_A,
    type: "form",
    title: "Contact form",
    slug: "contact-form",
    status: "draft",
    rev: 0,
    draft: makeDocumentBody(),
    publishedVersionId: null,
    createdAt: fixedNow(),
    updatedAt: fixedNow(),
    ...overrides,
  };
}

/**
 * Mirrors the documents-module contract (spec §3/§8): tenant-scoped queries,
 * CONFLICT on stale baseRev, FORBIDDEN on cross-workspace ids, ops applied
 * in order with DocumentBody validation left to the caller/service.
 */
export class FakeDocuments implements DocumentService {
  readonly rows: FakeDocRow[] = [];
  /** Observed (op, ctx) pairs — lets tests assert ctx construction. */
  readonly seenCtx: { op: string; ctx: Ctx }[] = [];
  /** When true, the next applyOps returns a structurally invalid draft. */
  corruptNextApplyOps = false;

  constructor(seed: FakeDocRow[] = []) {
    this.rows.push(...seed);
  }

  async listDocuments(ctx: Ctx, query: ListDocumentsQuery): Promise<Result<Page<DocumentSummary>>> {
    this.seenCtx.push({ op: "listDocuments", ctx });
    const filtered = this.rows
      .filter((row) => row.workspaceId === ctx.workspaceId)
      .filter((row) => query.type === undefined || row.type === query.type)
      .filter((row) => query.status === undefined || row.status === query.status)
      .filter((row) => query.q === undefined || row.title.toLowerCase().includes(query.q.toLowerCase()))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const limit = query.limit ?? 50;
    let start = 0;
    if (query.cursor !== undefined) {
      const index = filtered.findIndex((row) => row.id === query.cursor);
      if (index === -1) return err(new AppError("VALIDATION", "Unknown cursor"));
      start = index + 1;
    }
    const page = filtered.slice(start, start + limit);
    return ok({
      data: page.map(toSummary),
      nextCursor: start + limit < filtered.length ? (page.at(-1)?.id ?? null) : null,
    });
  }

  async getDocument(ctx: Ctx, documentId: string): Promise<Result<DocumentDetail>> {
    this.seenCtx.push({ op: "getDocument", ctx });
    const found = this.findScoped(ctx, documentId);
    return found.ok ? ok(toDetail(found.value)) : found;
  }

  async createDocument(ctx: Ctx, input: CreateDocumentInput): Promise<Result<DocumentDetail>> {
    this.seenCtx.push({ op: "createDocument", ctx });
    const slug = input.slug ?? slugify(input.title);
    if (this.rows.some((row) => row.workspaceId === ctx.workspaceId && row.slug === slug)) {
      return err(new AppError("CONFLICT", "Slug already in use in this workspace"));
    }
    const now = ctx.now();
    const row: FakeDocRow = {
      id: `doc_${randomUUID()}`,
      workspaceId: ctx.workspaceId,
      type: input.type,
      title: input.title,
      slug,
      status: "draft",
      rev: 0,
      draft: input.body ?? makeDocumentBody({ type: input.type }),
      publishedVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return ok(toDetail(row));
  }

  async applyOps(ctx: Ctx, documentId: string, input: ApplyOpsInput): Promise<Result<DocumentDetail>> {
    this.seenCtx.push({ op: "applyOps", ctx });
    const found = this.findScoped(ctx, documentId);
    if (!found.ok) return found;
    const row = found.value;
    if (input.baseRev !== row.rev) {
      return err(
        new AppError("CONFLICT", "Document changed since baseRev", [
          { path: "baseRev", message: `current revision is ${row.rev}` },
        ]),
      );
    }
    row.rev += 1;
    row.draft = this.corruptNextApplyOps
      ? ({ schemaVersion: 2 } as unknown as DocumentBody)
      : applyOpsToBody(row.draft, input.ops);
    row.updatedAt = ctx.now();
    for (const op of input.ops) {
      if (op.op === "meta.update") {
        if (op.patch.title !== undefined) row.title = op.patch.title;
        // B1/§21 made patch.slug nullable as the undo delete-token; this
        // fake's row model keeps a required slug, so null is a no-op here.
        if (op.patch.slug != null) row.slug = op.patch.slug;
      }
    }
    return ok(toDetail(row));
  }

  async publishDocument(ctx: Ctx, documentId: string): Promise<Result<PublishResult>> {
    this.seenCtx.push({ op: "publishDocument", ctx });
    const found = this.findScoped(ctx, documentId);
    if (!found.ok) return found;
    const row = found.value;
    const publishedVersionId = `ver_${randomUUID()}`;
    row.status = "published";
    row.publishedVersionId = publishedVersionId;
    row.updatedAt = ctx.now();
    return ok({ id: row.id, status: "published", publishedVersionId, rev: row.rev });
  }

  private findScoped(ctx: Ctx, documentId: string): Result<FakeDocRow> {
    const row = this.rows.find((candidate) => candidate.id === documentId);
    if (row === undefined) return err(new AppError("NOT_FOUND", "Document not found"));
    if (row.workspaceId !== ctx.workspaceId) {
      return err(new AppError("FORBIDDEN", "Document belongs to another workspace"));
    }
    return ok(row);
  }
}

/** Strips the fake-internal `workspaceId` before crossing the MCP surface. */
function toSubmissionRow(row: FakeSubmissionRow): SubmissionRow {
  return {
    id: row.id,
    documentId: row.documentId,
    versionId: row.versionId,
    status: row.status,
    completedAt: row.completedAt,
    answers: row.answers,
    variables: row.variables,
    hidden: row.hidden,
  };
}

function toSummary(row: FakeDocRow): DocumentSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    slug: row.slug,
    status: row.status,
    rev: row.rev,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: FakeDocRow): DocumentDetail {
  return {
    ...toSummary(row),
    draft: row.draft,
    publishedVersionId: row.publishedVersionId,
    createdAt: row.createdAt.toISOString(),
  };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "document" : slug;
}

/** Shallow patch merge with §-ops "null deletes the key" semantics (canonical op contract). */
function mergePatch<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown> | undefined): T {
  if (patch === undefined) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) out[key] = value;
  }
  return out as T;
}

/** Fake-side op application: covers the structural ops a fake can honour;
 * the real op engine lives in the documents module (T02/T20). */
function applyOpsToBody(body: DocumentBody, ops: Op[]): DocumentBody {
  let next = body;
  for (const op of ops) {
    switch (op.op) {
      case "block.insert": {
        const blocks = [...next.blocks];
        blocks.splice(Math.min(op.index, blocks.length), 0, op.block);
        next = { ...next, blocks };
        break;
      }
      case "block.update":
        next = {
          ...next,
          blocks: next.blocks.map((block) =>
            block.id === op.id ? { ...block, props: { ...block.props, ...op.props } } : block,
          ),
        };
        break;
      case "theme.update":
        next = { ...next, theme: mergePatch(next.theme as Record<string, unknown>, op.patch) as Theme };
        break;
      case "settings.update":
        next = {
          ...next,
          settings: mergePatch(next.settings as Record<string, unknown>, op.patch) as DocumentSettings,
        };
        break;
      default:
        // block.move / block.remove / ending.* / rule.*: accepted, revision
        // still advances — tree manipulation is the real module's job.
        break;
    }
  }
  return next;
}

// --- submissions ------------------------------------------------------------

export type FakeSubmissionRow = SubmissionRow & { workspaceId: string };

export class FakeSubmissions implements SubmissionService {
  readonly rows: FakeSubmissionRow[] = [];
  private readonly documentWorkspaces = new Map<string, string>();

  constructor(
    seed: FakeSubmissionRow[] = [],
    options: {
      documentWorkspaces?: Record<string, string>;
      /** blockId → block kind (drives NPS detection). */
      questionKinds?: Record<string, string>;
    } = {},
  ) {
    this.rows.push(...seed);
    for (const row of seed) this.documentWorkspaces.set(row.documentId, row.workspaceId);
    for (const [documentId, workspaceId] of Object.entries(options.documentWorkspaces ?? {})) {
      this.documentWorkspaces.set(documentId, workspaceId);
    }
    this.questionKinds = options.questionKinds ?? {};
  }

  private readonly questionKinds: Record<string, string>;

  /** Registers a document→workspace mapping (tests: documents created mid-run). */
  registerDocument(documentId: string, workspaceId: string): void {
    this.documentWorkspaces.set(documentId, workspaceId);
  }

  async listSubmissions(
    ctx: Ctx,
    documentId: string,
    query: ListSubmissionsQuery,
  ): Promise<Result<Page<SubmissionRow>>> {
    const access = this.checkAccess(ctx, documentId);
    if (!access.ok) return access;
    const filtered = this.rows
      .filter((row) => row.documentId === documentId)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    const limit = query.limit ?? 50;
    let start = 0;
    if (query.cursor !== undefined) {
      const index = filtered.findIndex((row) => row.id === query.cursor);
      if (index === -1) return err(new AppError("VALIDATION", "Unknown cursor"));
      start = index + 1;
    }
    const page = filtered.slice(start, start + limit);
    return ok({
      data: page.map(toSubmissionRow),
      nextCursor: start + limit < filtered.length ? (page.at(-1)?.id ?? null) : null,
    });
  }

  async summarizeResponses(ctx: Ctx, documentId: string): Promise<Result<ResponseSummary>> {
    const access = this.checkAccess(ctx, documentId);
    if (!access.ok) return access;
    const rows = this.rows.filter((row) => row.documentId === documentId);
    const completedRows = rows.filter((row) => row.status === "completed");

    const byBlock = new Map<string, { label: string; kind: string; values: unknown[] }>();
    for (const row of completedRows) {
      for (const [blockId, answer] of Object.entries(row.answers)) {
        const entry = byBlock.get(blockId) ?? {
          label: answer.label,
          kind: this.questionKinds[blockId] ?? "unknown",
          values: [],
        };
        entry.values.push(answer.value);
        byBlock.set(blockId, entry);
      }
    }

    const perQuestion: QuestionAggregate[] = [];
    let nps: NpsSummary | null = null;
    for (const [blockId, entry] of byBlock) {
      const numbers = entry.values.filter((value): value is number => typeof value === "number");
      if (entry.kind === "nps" && numbers.length > 0) {
        const promoters = numbers.filter((value) => value >= 9).length;
        const passives = numbers.filter((value) => value >= 7 && value <= 8).length;
        const detractors = numbers.filter((value) => value <= 6).length;
        nps = {
          promoters,
          passives,
          detractors,
          responses: numbers.length,
          score: Math.round(((promoters - detractors) / numbers.length) * 100),
        };
      }
      if (entry.values.length > 0 && numbers.length === entry.values.length) {
        perQuestion.push({
          blockId,
          label: entry.label,
          kind: entry.kind,
          answered: entry.values.length,
          average: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
        });
      } else {
        const distribution: Record<string, number> = {};
        for (const value of entry.values) {
          const key = JSON.stringify(value) ?? "null";
          distribution[key] = (distribution[key] ?? 0) + 1;
        }
        perQuestion.push({ blockId, label: entry.label, kind: entry.kind, answered: entry.values.length, distribution });
      }
    }

    return ok({ documentId, total: rows.length, completed: completedRows.length, perQuestion, nps });
  }

  private checkAccess(ctx: Ctx, documentId: string): Result<null> {
    const workspaceId = this.documentWorkspaces.get(documentId);
    if (workspaceId === undefined) return err(new AppError("NOT_FOUND", "Document not found"));
    if (workspaceId !== ctx.workspaceId) {
      return err(new AppError("FORBIDDEN", "Document belongs to another workspace"));
    }
    return ok(null);
  }
}

// --- composition ------------------------------------------------------------

export function tokenFor(
  tokenId: string,
  workspaceId: string,
  scopes: readonly Scope[] = ALL_SCOPES,
): TokenRecord {
  return { tokenId, workspaceId, scopes: [...scopes] };
}

export function makeDeps(overrides: Partial<FormForgeMcpDeps> = {}): {
  deps: FormForgeMcpDeps;
  tokens: FakeTokens;
  documents: FakeDocuments;
  submissions: FakeSubmissions;
  audit: InMemoryAuditLog;
} {
  const documents =
    overrides.documents instanceof FakeDocuments ? overrides.documents : new FakeDocuments();
  const submissions =
    overrides.submissions instanceof FakeSubmissions ? overrides.submissions : new FakeSubmissions();
  const audit = overrides.audit instanceof InMemoryAuditLog ? overrides.audit : new InMemoryAuditLog();
  const tokens =
    overrides.tokens instanceof FakeTokens
      ? overrides.tokens
      : new FakeTokens({
          [TOKEN_A]: tokenFor(TOKEN_ID_A, WORKSPACE_A),
          [TOKEN_B]: tokenFor(TOKEN_ID_B, WORKSPACE_B),
        });
  const deps: FormForgeMcpDeps = {
    rawToken: TOKEN_A,
    tokens,
    documents,
    submissions,
    audit,
    now: fixedNow,
    ...overrides,
  };
  return { deps, tokens, documents, submissions, audit };
}

export const TOKEN_A = "ff_token_workspace_a";
export const TOKEN_B = "ff_token_workspace_b";
