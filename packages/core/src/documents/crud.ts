// T07 — documents CRUD + ops-based PATCH service (spec §6, §8, §11).
//
// Ctx-scoped (spec §3): every function takes the kernel `Ctx` first and all
// repository calls carry `ctx.workspaceId`. Time comes from `ctx.now()` —
// never `new Date()` (spec §4). Results use the kernel `Result` type; errors
// are kernel `AppError`s with §4 field details.
//
// PATCH semantics (spec §8): the batch of ops is applied in memory against the
// current draft, the RESULT is validated with the DraftValidator, and only
// then is one atomic conditional write performed (rev check + bump inside
// `updateDraft`). A stale `baseRev` → `RevConflictError` carrying the current
// rev AND body, which the API layer answers as 409 CONFLICT.
import { AppError, err, ok, type Ctx, type Result } from '../bridge';
import { uuidv7 } from '../shared/ids';
import type { DocumentBodyJson, DocumentRecord, DocumentType } from './model';
import type { DraftValidationIssue, DraftValidator } from './ports';
import { applyDocOps, DocOpError, type OpDoc, type WireOp } from './apply';
import type { CrudDocumentsRepo } from './crud-ports';

export type CrudDeps = {
  documents: CrudDocumentsRepo;
  /** Full-document validation for create + every PATCH result (spec §8). */
  validator: DraftValidator;
  /** Sanity cap on ops per PATCH (spec §8 does not pin one). Default 500. */
  maxOpsPerPatch?: number;
};

export type CreateDocumentInput = {
  type: DocumentType;
  title: string;
  /** Optional pre-validated DocumentBody (template instantiation, spec §14.1.2). */
  initialBody?: DocumentBodyJson;
};

export type PatchDocumentInput = {
  baseRev: number;
  ops: readonly WireOp[];
};

// ---------------------------------------------------------------------------
// Slug + cursor helpers
// ---------------------------------------------------------------------------

const SLUG_FALLBACK = 'document';

/** Deterministic kebab slug from a title (spec §6: slug is human-readable). */
export function slugifyTitle(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : SLUG_FALLBACK;
}

/** Opaque cursor payload: base64url JSON of the keyset position. */
export function encodeDocumentCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt.toISOString(), i: id }), 'utf8')
    .toString('base64url');
}

export function decodeDocumentCursor(
  cursor: string,
): { updatedAtMs: number; id: string } | null {
  try {
    const json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      u?: string;
      i?: string;
    };
    const ms = json.u ? Date.parse(json.u) : NaN;
    if (!Number.isFinite(ms) || typeof json.i !== 'string' || json.i.length === 0) return null;
    return { updatedAtMs: ms, id: json.i };
  } catch {
    return null;
  }
}

/** First free `slug`, `-2`, `-3`, … within the workspace (spec §6 unique). */
async function uniqueSlug(
  repo: CrudDocumentsRepo,
  workspaceId: string,
  desired: string,
  ignoreDocumentId?: string,
): Promise<string> {
  const taken = new Set<string>();
  // Walk the small collision family; also guard the exact base.
  for (let candidate = desired, n = 1; n < 1000; n++) {
    const existing = await repo.findBySlug(workspaceId, candidate);
    if (!existing || existing.id === ignoreDocumentId) return candidate;
    taken.add(candidate);
    candidate = `${desired}-${n + 1}`;
  }
  // Practically unreachable; keep deterministic even under pathological data.
  return `${desired}-${Date.now().toString(36)}`;
}

function validationError(message: string, details: ReadonlyArray<{ path?: string; message: string }>): AppError {
  return new AppError('VALIDATION', message, [...details]);
}

function issuesToDetails(issues: readonly DraftValidationIssue[]) {
  return issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

/** Structural empty DocumentBody per type (spec §7; mirrors @formforge/schema). */
export function emptyDocumentBody(type: DocumentType): DocumentBodyJson {
  return {
    schemaVersion: 1,
    type,
    theme: {
      tokens: {},
      fontHeading: 'Inter',
      fontBody: 'Inter',
      radius: 'md',
    },
    settings: {
      seo: {},
      locale: 'en',
      progressBar: true,
      autoAdvance: true,
      showBranding: true,
      captcha: false,
      notifyEmails: [],
    },
    blocks: [],
    endings: [],
    logic: { rules: [] },
  };
}

const DOCUMENT_TYPES: readonly DocumentType[] = ['form', 'page', 'portfolio'];

// ---------------------------------------------------------------------------
// create / get / list / duplicate / archive
// ---------------------------------------------------------------------------

export function makeCreateDocument(deps: CrudDeps) {
  return async function createDocument(
    ctx: Ctx,
    input: CreateDocumentInput,
  ): Promise<Result<DocumentRecord, AppError>> {
    const title = input.title.trim();
    if (title.length === 0) {
      return err(validationError('Invalid input', [{ path: 'title', message: 'Title is required' }]));
    }
    if (!DOCUMENT_TYPES.includes(input.type)) {
      return err(
        validationError('Invalid input', [
          { path: 'type', message: `Unknown document type "${String(input.type)}"` },
        ]),
      );
    }

    const body = input.initialBody ?? emptyDocumentBody(input.type);
    const issues = await deps.validator.validate(body);
    if (issues.length > 0) {
      return err(validationError('Invalid document body', issuesToDetails(issues)));
    }

    const now = ctx.now();
    const record: DocumentRecord = {
      id: uuidv7(now.getTime()),
      workspaceId: ctx.workspaceId,
      type: input.type,
      title,
      slug: await uniqueSlug(deps.documents, ctx.workspaceId, slugifyTitle(title)),
      status: 'draft',
      rev: 0,
      draft: body,
      publishedVersionId: null,
      createdBy: ctx.actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await deps.documents.insert(record);
    return ok(record);
  };
}

export function makeGetDocument(deps: CrudDeps) {
  return async function getDocument(
    ctx: Ctx,
    documentId: string,
  ): Promise<Result<DocumentRecord, AppError>> {
    const record = await deps.documents.getById(ctx.workspaceId, documentId);
    if (!record) return err(notFound(documentId));
    return ok(record);
  };
}

export function makeListDocuments(deps: CrudDeps) {
  return async function listDocuments(
    ctx: Ctx,
    query: { type?: DocumentType; status?: string; q?: string; limit?: number; cursor?: string | null },
  ): Promise<Result<{ items: DocumentRecord[]; nextCursor: string | null }, AppError>> {
    if (query.type !== undefined && !DOCUMENT_TYPES.includes(query.type)) {
      return err(validationError('Invalid input', [{ path: 'type', message: 'Unknown document type' }]));
    }
    if (
      query.status !== undefined &&
      !['draft', 'published', 'archived'].includes(query.status)
    ) {
      return err(validationError('Invalid input', [{ path: 'status', message: 'Unknown status' }]));
    }
    if (query.cursor) {
      const decoded = decodeDocumentCursor(query.cursor);
      if (!decoded) {
        return err(validationError('Invalid input', [{ path: 'cursor', message: 'Malformed cursor' }]));
      }
    }
    const page = await deps.documents.list(ctx.workspaceId, {
      type: query.type,
      status: query.status as DocumentRecord['status'] | undefined,
      q: query.q,
      limit: query.limit ?? 50,
      cursor: query.cursor ?? null,
    });
    return ok(page);
  };
}

export function makeDuplicateDocument(deps: CrudDeps) {
  return async function duplicateDocument(
    ctx: Ctx,
    documentId: string,
  ): Promise<Result<DocumentRecord, AppError>> {
    const source = await deps.documents.getById(ctx.workspaceId, documentId);
    if (!source) return err(notFound(documentId));

    const now = ctx.now();
    const title = `${source.title} (copy)`;
    const record: DocumentRecord = {
      ...source,
      id: uuidv7(now.getTime()),
      title,
      slug: await uniqueSlug(deps.documents, ctx.workspaceId, slugifyTitle(title)),
      status: 'draft',
      rev: 0,
      draft: structuralCopy(source.draft),
      publishedVersionId: null,
      createdBy: ctx.actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await deps.documents.insert(record);
    return ok(record);
  };
}

export function makeArchiveDocument(deps: CrudDeps) {
  return async function archiveDocument(
    ctx: Ctx,
    documentId: string,
  ): Promise<Result<DocumentRecord, AppError>> {
    const now = ctx.now();
    const updated = await deps.documents.setStatus(ctx.workspaceId, documentId, 'archived', now);
    if (!updated) return err(notFound(documentId));
    return ok(updated);
  };
}

// ---------------------------------------------------------------------------
// PATCH — the autosave endpoint (spec §8)
// ---------------------------------------------------------------------------

/**
 * `409 CONFLICT` per spec §8 — carries the CURRENT rev + body so the autosave
 * client can refetch-free recover ("recover from 409 by refetch + reapply":
 * the body rides along, and `ApiTransport` reads it). The API layer answers
 * with `{ error: …, rev, body }`.
 */
export class RevConflictError extends AppError {
  readonly currentRev: number;
  readonly currentBody: unknown;

  constructor(currentRev: number, currentBody: unknown, baseRev: number) {
    super('CONFLICT', 'Document was modified by someone else — baseRev is stale', [
      { path: 'rev', message: String(currentRev) },
      { path: 'baseRev', message: baseRev === currentRev ? 'stale' : `have ${baseRev}` },
    ]);
    this.name = 'RevConflictError';
    this.currentRev = currentRev;
    this.currentBody = currentBody;
  }
}

/** Duck-typed guard (AppError instances may cross module boundaries). */
export function isRevConflict(error: unknown): error is RevConflictError {
  return (
    error instanceof Error &&
    error.name === 'RevConflictError' &&
    'currentRev' in error &&
    'currentBody' in error
  );
}

const PATCH_MAX_RETRIES = 2; // read-update retries after a racing write

export function makePatchDocument(deps: CrudDeps) {
  return async function patchDocument(
    ctx: Ctx,
    documentId: string,
    input: PatchDocumentInput,
  ): Promise<Result<DocumentRecord, AppError>> {
    const maxOps = deps.maxOpsPerPatch ?? 500;
    if (input.ops.length > maxOps) {
      return err(
        validationError('Too many ops in one patch', [
          { path: 'ops', message: `A patch may contain at most ${maxOps} ops` },
        ]),
      );
    }

    for (let attempt = 0; attempt <= PATCH_MAX_RETRIES; attempt++) {
      const record = await deps.documents.getById(ctx.workspaceId, documentId);
      if (!record) return err(notFound(documentId));
      if (record.status === 'archived') {
        return err(
          validationError('Document is archived', [
            { path: 'status', message: 'Archived documents cannot be edited' },
          ]),
        );
      }
      if (input.baseRev !== record.rev) {
        return err(new RevConflictError(record.rev, record.draft, input.baseRev));
      }

      // 1. Apply the ops batch against the current draft (pure, in memory).
      let next: OpDoc;
      try {
        next = applyDocOps(
          {
            meta: { title: record.title, slug: record.slug },
            body: record.draft as DocumentBodyJson,
          },
          input.ops,
        );
      } catch (error) {
        if (error instanceof DocOpError) {
          return err(validationError('Invalid ops', [{ path: error.path, message: error.message }]));
        }
        throw error;
      }

      // 2. Enforce workspace-unique slugs when a meta.update changed it.
      if (next.meta.slug !== undefined && next.meta.slug !== record.slug) {
        const clash = await deps.documents.findBySlug(ctx.workspaceId, next.meta.slug);
        if (clash && clash.id !== record.id) {
          const opIndex = input.ops.findIndex(
            (op) => (op as { op: string }).op === 'meta.update',
          );
          return err(
            validationError('Invalid ops', [
              {
                path: `ops[${opIndex < 0 ? 0 : opIndex}].patch.slug`,
                message: `Slug "${next.meta.slug}" is already in use in this workspace`,
              },
            ]),
          );
        }
      }

      // 3. Validate the RESULT with the full DocumentBody validator (spec §8).
      const issues = await deps.validator.validate(next.body);
      if (issues.length > 0) {
        return err(validationError('Invalid document body', issuesToDetails(issues)));
      }

      // 4. One conditional write: rev check + bump + timestamps (spec §8
      //    "in one transaction"). A racing writer surfaces as a conflict and
      //    the whole apply is retried against the fresh state.
      const updated = await deps.documents.updateDraft(
        ctx.workspaceId,
        documentId,
        record.rev,
        {
          title: next.meta.title !== record.title ? next.meta.title : undefined,
          slug: next.meta.slug !== undefined && next.meta.slug !== record.slug ? next.meta.slug : undefined,
          draft: next.body,
        },
        ctx.now(),
      );
      if (updated === 'CONFLICT') {
        if (attempt < PATCH_MAX_RETRIES) continue;
        const fresh = await deps.documents.getById(ctx.workspaceId, documentId);
        return err(
          new RevConflictError(fresh?.rev ?? record.rev + 1, fresh?.draft ?? record.draft, input.baseRev),
        );
      }
      return ok(updated);
    }
    // Unreachable (the loop returns on every path).
    return err(new AppError('INTERNAL', 'patchDocument: exhausted retries'));
  };
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function structuralCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function notFound(documentId: string): AppError {
  return AppError.notFound(`Document ${documentId} not found`);
}
