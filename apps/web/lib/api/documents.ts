/**
 * T07 — composition root for the documents API (spec §3, §6, §8, §11).
 *
 * Two surfaces share one repository pair:
 *  - the publish pipeline (T10: publish/unpublish), and
 *  - the documents CRUD + ops PATCH module (T07: create/get/list/duplicate/
 *    archive/PATCH with rev-409).
 *
 * Repository selection (mirrors the identity container's lazy env check):
 *  - `DATABASE_URL` set  → SQL repositories over a pg pool (spec §6 tables);
 *  - otherwise           → in-memory stores (dev/test; no persistence).
 *
 * Route handlers call `documentsApi` / `documentsCrud` with the API `Ctx`
 * from `_lib/auth`; the container maps it to the kernel Ctx the core services
 * expect. Tests can swap everything via `configureDocumentsApi` /
 * `configureCrudDocuments`.
 */
import { Pool } from 'pg';
import {
  AppError,
  createInMemoryCrudDocumentStore,
  createInMemoryDocumentStore,
  defaultPublicUrlBuilder,
  devAssetUrlResolver,
  err,
  isRevConflict,
  makeArchiveDocument,
  makeCreateDocument,
  makeDuplicateDocument,
  makeGetDocument,
  makeGetPublishedSnapshot,
  makeListDocuments,
  makePatchDocument,
  makePublishDocument,
  makeTakedownDocument,
  makeUnpublishDocument,
  noopCdnPurge,
  type CrudDocumentsRepo,
  type Ctx as KernelCtx,
  type DraftValidator,
  type DocumentRecord,
  type GetPublishedSnapshot,
  type PublishOutcome,
  type PublishPipelineDeps,
  type Result,
  type TakedownOutcome,
  type UnpublishOutcome,
  type WireOp,
} from '@formforge/core';
import { t13LogicCompiler } from './logic-compiler';
import type { BuilderEntitlements } from './entitlements';
import type { Ctx as ApiCtx } from '@formforge/core/api';
import { instantiateTemplate } from '@formforge/core/templates';
import { DocumentBody, documentIssuesFromZodError } from '@formforge/schema';
import {
  createDocumentVersionsRepo,
  createSqlDocumentsRepo,
  createSqlSnapshotsRepo,
  type SqlExecutor,
} from '@formforge/db';

// ---------------------------------------------------------------------------
// Repositories (lazy singletons — importing this module never requires a DB)
// ---------------------------------------------------------------------------

let sqlExecutor: SqlExecutor | null = null;

function getSqlExecutor(): SqlExecutor {
  if (!sqlExecutor) {
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    sqlExecutor = {
      async query(text: string, params?: readonly unknown[]) {
        const result = await pool.query(text, (params ?? []) as unknown[]);
        return { rows: result.rows as unknown as Record<string, unknown>[] };
      },
    };
  }
  return sqlExecutor;
}

const usingSql = (): boolean => !!process.env['DATABASE_URL'];

let crudRepo: CrudDocumentsRepo | null = null;

export function getCrudDocumentsRepo(): CrudDocumentsRepo {
  if (!crudRepo) {
    crudRepo = usingSql()
      ? createSqlDocumentsRepo(getSqlExecutor())
      : createInMemoryCrudDocumentStore().documents;
  }
  return crudRepo;
}

/**
 * The full-DocumentBody validator (spec §8 "validates result with
 * DocumentBody") — built on the canonical Zod schema; issues map to §4
 * field details with paths like `blocks[2].props.title`.
 */
export const schemaDraftValidator: DraftValidator = {
  async validate(body: unknown) {
    const parsed = DocumentBody.safeParse(body);
    return parsed.success ? [] : documentIssuesFromZodError(parsed.error);
  },
};

// ---------------------------------------------------------------------------
// Kernel Ctx mapping (API Ctx from _lib/auth → kernel Ctx for core services)
// ---------------------------------------------------------------------------

export function toKernelCtx(apiCtx: ApiCtx): KernelCtx {
  const actor = apiCtx.actor;
  return {
    workspaceId: apiCtx.workspaceId,
    actor:
      actor.kind === 'session'
        ? { type: 'user', id: actor.userId }
        : actor.kind === 'token'
          ? { type: 'token', id: actor.tokenId }
          : { type: 'system', id: 'system' },
    requestId: apiCtx.requestId,
    now: () => apiCtx.now(),
  };
}

// ---------------------------------------------------------------------------
// CRUD service (T07)
// ---------------------------------------------------------------------------

let crudDeps: { documents: CrudDocumentsRepo; validator: DraftValidator } | null = null;

export function configureCrudDocuments(next: {
  documents: CrudDocumentsRepo;
  validator?: DraftValidator;
}): void {
  crudDeps = { documents: next.documents, validator: next.validator ?? schemaDraftValidator };
}

function getCrudDeps() {
  if (!crudDeps) configureCrudDocuments({ documents: getCrudDocumentsRepo() });
  return crudDeps!;
}

export type CreateDocumentApiInput = {
  type: DocumentRecord['type'];
  title: string;
  templateId?: string;
};

/**
 * Create a document (spec §11 POST /documents): an empty DocumentBody per
 * type, or the template body when `templateId` is given (spec §14.1.2 create
 * modal "blank/template").
 */
async function createDocument(
  ctx: ApiCtx,
  input: CreateDocumentApiInput,
): Promise<Result<DocumentRecord, AppError>> {
  let initialBody;
  if (input.templateId) {
    const tpl = instantiateTemplate(toKernelCtx(ctx), input.templateId, { title: input.title });
    if (!tpl.ok) {
      return err(new AppError((tpl.error.code ?? 'NOT_FOUND') as AppError['code'], tpl.error.message));
    }
    if (tpl.data.type !== input.type) {
      return err(
        AppError.validation('Template type mismatch', [
          { path: 'templateId', message: `Template is a ${tpl.data.type}, not a ${input.type}` },
        ]),
      );
    }
    initialBody = tpl.data.body;
  }
  return makeCreateDocument(getCrudDeps())(toKernelCtx(ctx), {
    type: input.type,
    title: input.title,
    initialBody,
  });
}

export type ListDocumentsApiQuery = {
  type?: DocumentRecord['type'];
  status?: DocumentRecord['status'];
  q?: string;
  limit?: number;
  cursor?: string | null;
};

export const documentsCrud = {
  create: createDocument,
  get: (ctx: ApiCtx, id: string) => makeGetDocument(getCrudDeps())(toKernelCtx(ctx), id),
  list: (ctx: ApiCtx, query: ListDocumentsApiQuery) =>
    makeListDocuments(getCrudDeps())(toKernelCtx(ctx), query),
  duplicate: (ctx: ApiCtx, id: string) => makeDuplicateDocument(getCrudDeps())(toKernelCtx(ctx), id),
  archive: (ctx: ApiCtx, id: string) => makeArchiveDocument(getCrudDeps())(toKernelCtx(ctx), id),
  patch: (ctx: ApiCtx, id: string, input: { baseRev: number; ops: readonly WireOp[] }) =>
    makePatchDocument(getCrudDeps())(toKernelCtx(ctx), id, input),
};

export { isRevConflict };

// ---------------------------------------------------------------------------
// Publish pipeline (T10) — same repository pair, so publish/CRUD never diverge
// ---------------------------------------------------------------------------

function buildDefaultDeps(): PublishPipelineDeps {
  const baseUrl = process.env['PUBLIC_BASE_URL'] ?? 'http://localhost:3000';
  const cdnBase = process.env['S3_PUBLIC_CDN_URL'] ?? `${baseUrl}/assets`;
  if (usingSql()) {
    const exec = getSqlExecutor();
    return {
      documents: createSqlDocumentsRepo(exec),
      versions: createDocumentVersionsRepo(exec),
      snapshots: createSqlSnapshotsRepo(exec),
      cdn: noopCdnPurge,
      validator: schemaDraftValidator,
      // T20 (issue #20): publish gating runs T13's logic lint (dangling goto
      // targets, unknown scopes, fallbacks, cycles) via the engine package.
      compiler: t13LogicCompiler,
      assets: devAssetUrlResolver(cdnBase),
      publicUrl: defaultPublicUrlBuilder(baseUrl),
    };
  }
  // Dev: the CRUD-capable in-memory document store + in-memory versions and
  // snapshots from the T10 store (keyed by documentId — dev consistency only).
  const publishStore = createInMemoryDocumentStore();
  return {
    documents: getCrudDocumentsRepo(),
    versions: publishStore.versions,
    snapshots: publishStore.snapshots,
    cdn: noopCdnPurge,
    validator: schemaDraftValidator,
    // T20 (issue #20): publish gating runs T13's logic lint (dangling goto
    // targets, unknown scopes, fallbacks, cycles) via the engine package.
    compiler: t13LogicCompiler,
    assets: devAssetUrlResolver(cdnBase),
    publicUrl: defaultPublicUrlBuilder(baseUrl),
  };
}

let deps: PublishPipelineDeps = buildDefaultDeps();

/** Swap the whole pipeline (integrator/test entry point). */
export function configureDocumentsApi(next: PublishPipelineDeps): void {
  deps = next;
}

export type DocumentsApi = {
  publishDocument: (ctx: ApiCtx, id: string) => Promise<Result<PublishOutcome, AppError>>;
  unpublishDocument: (ctx: ApiCtx, id: string) => Promise<Result<UnpublishOutcome, AppError>>;
  getPublishedSnapshot: GetPublishedSnapshot;
  /**
   * T29 (spec §17): staff takedown — status → 'archived', snapshot dropped,
   * CDN tag + route/snapshot keys purged. Auth happens at the route (staff
   * key); the service itself is unauthenticated-by-design (kernel layer).
   */
  takedownDocument: (ctx: ApiCtx, id: string) => Promise<Result<TakedownOutcome, AppError>>;
};

export const documentsApi: DocumentsApi = {
  publishDocument: (ctx: ApiCtx, id: string) => makePublishDocument(deps)(toKernelCtx(ctx), id),
  unpublishDocument: (ctx: ApiCtx, id: string) => makeUnpublishDocument(deps)(toKernelCtx(ctx), id),
  getPublishedSnapshot: (slug: string) => makeGetPublishedSnapshot(deps)(slug),
  takedownDocument: (ctx: ApiCtx, id: string) => makeTakedownDocument(deps)(toKernelCtx(ctx), id),
};

export type { TakedownOutcome };

// ---------------------------------------------------------------------------
// Wire mappers (§11 response schemas live in @formforge/schema/api)
// ---------------------------------------------------------------------------

export function toDocumentSummary(record: DocumentRecord) {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    slug: record.slug,
    status: record.status,
    rev: record.rev,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toDocumentDetail(record: DocumentRecord) {
  return {
    ...toDocumentSummary(record),
    draft: record.draft,
    publishedVersionId: record.publishedVersionId,
  };
}

/** GET /documents/{id} builder envelope — `body` is the current draft.
 * `entitlements` (§24, follow-up #8) is additive: the builder gate values
 * resolved via billing for the caller's workspace. */
export function toDocumentEnvelope(
  record: DocumentRecord,
  entitlements?: BuilderEntitlements,
) {
  return {
    ...toDocumentSummary(record),
    body: record.draft,
    publishedVersionId: record.publishedVersionId,
    entitlements,
  };
}
